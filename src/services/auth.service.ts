import "server-only";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { hashSecretToken, randomToken } from "@/lib/crypto";
import { enforceRateLimit, hitRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { isStaff, mfaRequired } from "@/lib/auth/permissions";
import type { AuthTokenType, Role } from "@/generated/prisma/enums";
import { recordAudit } from "./audit.service";
import { activationEmail, passwordResetEmail, sendEmail } from "./email.service";
import type { Actor } from "./context";

/**
 * AuthService — email/password authentication with server-side sessions.
 *
 * - Passwords: Argon2id (@node-rs/argon2 defaults: m=19456 KiB, t=2, p=1).
 * - Sessions: 256-bit random token in an httpOnly cookie; only HMAC(AUTH_SECRET, token) is stored,
 *   so a database leak alone cannot be replayed as a session. Sessions are revocable individually
 *   or all at once ("sign out everywhere").
 * - Staff sessions are short-lived (12h); member sessions last 30 days.
 * - Future providers (magic link, Apple, Google, passkeys) attach via `auth_identities` and
 *   reuse createSession().
 */

export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ACTIVATION_TTL_MS = 72 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

const tokenHash = (token: string) => hashSecretToken(token, env().AUTH_SECRET);

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

// Used to keep timing similar whether or not an email exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argonHash("joia-timing-equaliser-not-a-password"));

export type RequestMeta = { ipAddress?: string | null; userAgent?: string | null };

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(userId: string, role: Role, meta: RequestMeta) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (isStaff(role) ? STAFF_SESSION_TTL_MS : MEMBER_SESSION_TTL_MS));
  const session = await db.session.create({
    data: {
      tokenHash: tokenHash(token),
      userId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });
  return { token, expiresAt, sessionId: session.id };
}

export type SessionUser = {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  memberId: string | null;
  firstName: string | null;
  /** Admin roles: the password is confirmed, the authenticator code not yet (see mfa.service). */
  mfaPending: boolean;
  /** An authenticator is set up (otherwise a pending session is asked to set one up). */
  mfaEnabled: boolean;
};

/**
 * The session's user, or null. An admin session whose authenticator code isn't confirmed yet is
 * no session at all for pages, actions and APIs; only the MFA step asks for it (allowMfaPending).
 */
export async function validateSessionToken(
  token: string | undefined | null,
  { allowMfaPending = false }: { allowMfaPending?: boolean } = {},
): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { include: { member: { select: { id: true, firstName: true } } } } },
  });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;
  if (session.user.status !== "ACTIVE") return null;
  const mfaPending = mfaRequired(session.user.role) && !session.mfaVerified;
  if (mfaPending && !allowMfaPending) return null;

  if (now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    memberId: session.user.member?.id ?? null,
    firstName: session.user.member?.firstName ?? null,
    mfaPending,
    mfaEnabled: session.user.mfaEnabled,
  };
}

/** Revokes the session; returns the signed-out user's role (null if the token was unknown). */
export async function revokeSessionByToken(token: string): Promise<Role | null> {
  const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) }, select: { user: { select: { role: true } } } });
  await db.session.updateMany({
    where: { tokenHash: tokenHash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return session?.user.role ?? null;
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export async function signOutEverywhere(actor: Actor) {
  const count = await revokeAllSessions(actor.userId);
  await recordAudit(actor, { action: "auth.sign_out_all", entityType: "user", entityId: actor.userId, after: { revoked: count } });
  return count;
}

export async function listActiveSessions(actor: Actor) {
  return db.session.findMany({
    where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, ipAddress: true },
  });
}

// ─── Login ───────────────────────────────────────────────────────────────────

/** Emails are stored lower-cased; normalise here too so limiter keys can't be dodged by case/spaces. */
const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Per-IP limit. A request without a client IP skips it (logged) instead of sharing one global
 * "unknown" bucket that anyone could fill to lock everybody out; per-email limits still apply.
 */
async function enforcePerIpLimit(scope: string, meta: RequestMeta, { limit, window }: { limit: number; window: number }) {
  if (!meta.ipAddress) {
    console.warn(`[rate-limit] ${scope}: request has no client IP, per-IP limit skipped`);
    return;
  }
  await enforceRateLimit(`${scope}:ip:${meta.ipAddress}`, limit, window);
}

export async function authenticate(rawEmail: string, password: string, meta: RequestMeta) {
  const email = normaliseEmail(rawEmail);
  await enforcePerIpLimit("login", meta, RATE_LIMITS.loginPerIp);
  await enforceRateLimit(`login:email:${email}`, RATE_LIMITS.loginPerEmail.limit, RATE_LIMITS.loginPerEmail.window);

  // One message for unknown, not-yet-activated and wrong-password cases: membership of a
  // private club is itself sensitive, so sign-in must not reveal whether an email is invited.
  // There is deliberately no per-account lockout: its distinct answer revealed which emails have
  // an account, and it let anyone keep a member locked out. The per-email and per-IP limits above
  // are the brute-force protection (users.failed_login_count / locked_until are no longer used).
  const genericFailure = new AppError(
    "UNAUTHENTICATED",
    "Email or password is incorrect. If you were recently invited, please use the activation link in your invitation first.",
  );
  const user = await db.user.findUnique({ where: { email } });

  if (!user || !user.passwordHash) {
    await verifyPassword(await getDummyHash(), password); // same timing as a wrong password
    throw genericFailure;
  }
  if (!(await verifyPassword(user.passwordHash, password))) throw genericFailure;
  if (user.status === "DISABLED") {
    throw new AppError("FORBIDDEN", "This account is disabled. Please contact CLUB JOIA concierge.");
  }
  if (user.status !== "ACTIVE") {
    throw new AppError("INVALID_STATE", "Your account is not activated yet. Please use the link in your invitation.");
  }

  await db.user.update({
    where: { id: user.id },
    // Also clears values left by the former account lockout.
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const session = await createSession(user.id, user.role, meta);
  return { ...session, role: user.role, userId: user.id };
}

// ─── Single-use tokens (activation / reset) ─────────────────────────────────

async function issueAuthToken(userId: string, type: AuthTokenType, ttlMs: number) {
  const token = randomToken(32);
  await db.$transaction([
    // Only the newest link of a type stays valid.
    db.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    db.authToken.create({
      data: { userId, type, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

async function consumeAuthToken(token: string, type: AuthTokenType) {
  const row = await db.authToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) {
    throw new AppError(
      "INVALID_STATE",
      type === "ACTIVATION"
        ? "This activation link is invalid or has expired. Please ask CLUB JOIA concierge for a new invitation."
        : "This reset link is invalid or has expired. Please request a new one.",
    );
  }
  // Atomic single-use: only one concurrent request can flip usedAt.
  const claimed = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new AppError("INVALID_STATE", "This link has already been used.");
  return row.user;
}

export async function peekAuthToken(token: string, type: AuthTokenType) {
  if (!token || token.length > 200) return null;
  const row = await db.authToken.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) return null;
  return { email: row.user.email, name: row.user.name };
}

function appLink(path: string) {
  return new URL(path, env().NEXT_PUBLIC_APP_URL).toString();
}

/** Issue an activation link and (attempt to) email it. Returns the link for admin hand-off. */
export async function issueActivation(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status !== "PENDING_ACTIVATION") {
    throw new AppError("INVALID_STATE", "This account is already activated.");
  }
  const token = await issueAuthToken(userId, "ACTIVATION", ACTIVATION_TTL_MS);
  const link = appLink(`/activate?token=${encodeURIComponent(token)}`);
  const delivery = await sendEmail({ to: user.email, ...activationEmail(user.name, link) });
  return { link, delivered: delivery.delivered };
}

export const TERMS_VERSION = "2026-10-draft";

export async function activateAccount(token: string, password: string, meta: RequestMeta) {
  // Activation tokens are 256-bit, so the per-IP limit is the only (and enough) guard here.
  await enforcePerIpLimit("activate", meta, RATE_LIMITS.activationPerIp);
  const user = await consumeAuthToken(token, "ACTIVATION");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: "ACTIVE", emailVerifiedAt: new Date(), passwordChangedAt: new Date() },
    });
    const member = await tx.member.findUnique({ where: { userId: user.id } });
    if (member) {
      await tx.membership.updateMany({ where: { memberId: member.id, status: "INVITED" }, data: { status: "ACTIVE" } });
    }
    await tx.consentRecord.createMany({
      data: (["TERMS", "PRIVACY_POLICY"] as const).map((type) => ({
        userId: user.id,
        type,
        version: TERMS_VERSION,
        granted: true,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      })),
    });
    await recordAudit({ userId: user.id, ...meta }, { action: "auth.activate", entityType: "user", entityId: user.id }, tx);
  });
  const session = await createSession(user.id, user.role, meta);
  return { ...session, role: user.role };
}

export async function requestPasswordReset(rawEmail: string, meta: RequestMeta) {
  const email = normaliseEmail(rawEmail);
  await enforcePerIpLimit("reset", meta, RATE_LIMITS.passwordResetPerIp);
  const { allowed } = await hitRateLimit(
    `reset:email:${email}`,
    RATE_LIMITS.passwordResetPerEmail.limit,
    RATE_LIMITS.passwordResetPerEmail.window,
  );
  // Same response whether or not the account exists (no account enumeration).
  if (!allowed) return;
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return;
  const token = await issueAuthToken(user.id, "PASSWORD_RESET", RESET_TTL_MS);
  await sendEmail({ to: user.email, ...passwordResetEmail(user.name, appLink(`/reset-password?token=${encodeURIComponent(token)}`)) });
  await recordAudit({ userId: user.id, ...meta }, { action: "auth.password_reset_requested", entityType: "user", entityId: user.id });
}

/** Admin-initiated reset link (returned for hand-off while no email provider is configured). */
export async function issuePasswordResetLink(actor: Actor, userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status !== "ACTIVE") throw new AppError("INVALID_STATE", "Only active accounts can reset a password.");
  const token = await issueAuthToken(user.id, "PASSWORD_RESET", RESET_TTL_MS);
  const link = appLink(`/reset-password?token=${encodeURIComponent(token)}`);
  const delivery = await sendEmail({ to: user.email, ...passwordResetEmail(user.name, link) });
  await recordAudit(actor, { action: "auth.password_reset_issued", entityType: "user", entityId: user.id });
  return { link, delivered: delivery.delivered };
}

export async function resetPassword(token: string, password: string, meta: RequestMeta) {
  const user = await consumeAuthToken(token, "PASSWORD_RESET");
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date() },
  });
  await revokeAllSessions(user.id);
  await recordAudit({ userId: user.id, ...meta }, { action: "auth.password_reset", entityType: "user", entityId: user.id });
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
    throw new AppError("VALIDATION", "Current password is incorrect.", { current: ["Current password is incorrect."] });
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() },
  });
  // Keep this device signed in; sign out every other session.
  await revokeAllSessions(user.id, actor.sessionId);
  await recordAudit(actor, { action: "auth.password_change", entityType: "user", entityId: user.id });
}
