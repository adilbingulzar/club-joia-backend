import "server-only";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { AppError, notFound } from "@/lib/errors";
import { mfaRequired, STAFF_ROLES } from "@/lib/auth/permissions";
import { hitRateLimit, releaseRateLimitHit } from "@/lib/security/rate-limit";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, matchTotp, totpUri } from "@/lib/security/totp";
import { recordAudit } from "./audit.service";
import { revokeAllSessions, type RequestMeta, type SessionUser } from "./auth.service";
import { requirePermission, type Actor } from "./context";

/**
 * MfaService — authenticator-app codes (TOTP) for ADMIN and SUPER_ADMIN.
 *
 * After the password, an admin session is "pending" (sessions.mfa_verified = false) and counts as
 * signed out everywhere except the MFA step (/admin/mfa). There the admin either sets up an
 * authenticator (first time: scan the QR code, confirm one code) or enters the current code.
 * A confirmed code marks that session verified. Each code works once (users.mfa_last_used_step).
 * Lost phone: a super admin resets the account's MFA on Admin → Staff, or on the server
 * `npm run admin:create -- <email>` (which also resets MFA).
 */

const VERIFY_LIMIT = { limit: 5, window: 15 * 60 };

function encryptionKey(): string {
  const key = env().MFA_ENCRYPTION_KEY;
  if (!key) {
    throw new AppError("NOT_CONFIGURED", "Two-factor sign-in is not configured on the server yet (MFA_ENCRYPTION_KEY). Please contact the site administrator.");
  }
  return key;
}

/** The authenticator to set up: the QR code (SVG) and the same secret as text. */
export async function startMfaEnrolment(user: SessionUser) {
  if (!user.mfaPending) throw new AppError("INVALID_STATE", "This session does not need a code.");
  if (user.mfaEnabled) throw new AppError("INVALID_STATE", "An authenticator is already set up for this account.");
  const key = encryptionKey();
  const row = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { mfaSecretEncrypted: true } });

  // Keep the secret of an unfinished set-up, so reloading the page doesn't change the QR code.
  let secret: string | null = null;
  if (row.mfaSecretEncrypted) {
    try {
      secret = decryptTotpSecret(row.mfaSecretEncrypted, key);
    } catch {
      secret = null; // encrypted with an older key: start again
    }
  }
  if (!secret) {
    secret = generateTotpSecret();
    await db.user.update({ where: { id: user.userId }, data: { mfaSecretEncrypted: encryptTotpSecret(secret, key), mfaEnabled: false, mfaLastUsedStep: null } });
  }
  const uri = totpUri(secret, user.email);
  const qrSvg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#050505", light: "#ffffff" } });
  return { secret, qrSvg };
}

/**
 * Checks the code of a pending admin session. The first correct code also finishes the set-up.
 * After five failed codes in 15 minutes (per user) the next attempt ends the session (the password
 * is needed again). Correct codes don't count.
 */
export async function verifyMfaCode(user: SessionUser, code: string, meta: RequestMeta) {
  if (!user.mfaPending) return;
  const key = encryptionKey();
  // Every attempt reserves a hit before the code is checked, so parallel guesses can never get more
  // than five codes checked; a correct code gives its hit back, so only failures count.
  const limitKey = `mfa:user:${user.userId}`;
  const { allowed } = await hitRateLimit(limitKey, VERIFY_LIMIT.limit, VERIFY_LIMIT.window);
  if (!allowed) {
    await db.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
    await recordAudit({ userId: user.userId, ...meta }, { action: "auth.mfa_locked", entityType: "user", entityId: user.userId });
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  }

  const row = await db.user.findUniqueOrThrow({ where: { id: user.userId }, select: { mfaSecretEncrypted: true, mfaEnabled: true } });
  if (!row.mfaSecretEncrypted) throw new AppError("INVALID_STATE", "Set up your authenticator first.");
  let secret: string;
  try {
    secret = decryptTotpSecret(row.mfaSecretEncrypted, key);
  } catch {
    throw new AppError("INVALID_STATE", "Your authenticator can't be checked. Please ask a super admin to reset two-factor sign-in for your account.");
  }

  const step = matchTotp(secret, code);
  // A code works once: claim its step atomically (also stops two tabs using the same code).
  const claimed =
    step !== null &&
    (await db.user.updateMany({
      where: { id: user.userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
      data: { mfaLastUsedStep: step },
    })).count === 1;
  if (!claimed) {
    await recordAudit({ userId: user.userId, ...meta }, { action: "auth.mfa_failed", entityType: "user", entityId: user.userId });
    throw new AppError("VALIDATION", "That code is not correct. Enter the current 6-digit code from your authenticator app.", { code: ["Incorrect code."] });
  }
  await releaseRateLimitHit(limitKey);

  const enrolling = !row.mfaEnabled;
  await db.$transaction(async (tx) => {
    if (enrolling) await tx.user.update({ where: { id: user.userId }, data: { mfaEnabled: true, mfaEnrolledAt: new Date() } });
    await tx.session.update({ where: { id: user.sessionId }, data: { mfaVerified: true } });
    await recordAudit({ userId: user.userId, ...meta }, { action: enrolling ? "auth.mfa_enrolled" : "auth.mfa_verified", entityType: "user", entityId: user.userId }, tx);
  });
}

/** Super admin: clear a staff member's authenticator (lost phone). They set it up again at their next sign-in. */
export async function resetMfa(actor: Actor, userId: string) {
  requirePermission(actor, "staff:manage");
  if (userId === actor.userId) throw new AppError("INVALID_STATE", "Ask another super admin to reset your own two-factor sign-in.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !STAFF_ROLES.includes(user.role)) throw notFound("Staff member");
  await db.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaEnrolledAt: null, mfaLastUsedStep: null } });
  // Signed-in sessions were confirmed with the old authenticator.
  if (mfaRequired(user.role)) await revokeAllSessions(userId);
  await recordAudit(actor, { action: "staff.mfa_reset", entityType: "user", entityId: userId, before: { mfaEnabled: user.mfaEnabled }, after: { mfaEnabled: false } });
}
