import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { AppError, notFound } from "@/lib/errors";
import { signQrToken, verifyQrToken, type QrKeys } from "@/lib/qr/token";
import { localDateString } from "@/lib/time";
import { randomToken } from "@/lib/crypto";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  ACCESS_REASON_MESSAGES,
  evaluateAccess,
  isTicketFullyUsed,
  scanSeverity,
  type AccessDecision,
  type ScanSeverity,
} from "@/domain/access";
import { hasEntitlement, ENTITLEMENT_CODES } from "@/domain/entitlements";
import { pickCurrentMembership } from "@/domain/membership";
import type { ScanAction, ScanMethod, ScanResult } from "@/generated/prisma/enums";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { getMemberEntitlements } from "./entitlement.service";
import { createCredential, effectiveTicketStatus } from "./ticket.service";

/**
 * QRService — issues short-lived signed QR tokens to members and validates them at the door.
 *
 * Flow at the door:
 *   scan()     → verify signature → resolve credential → ticket → member → evaluate access → log VALIDATE
 *   checkIn()  → staff confirms; re-evaluates from the logged scan inside a transaction,
 *                records TicketCheckIn (DB-unique per entry policy) → log CHECK_IN
 *   deny()     → staff refuses entry → log DENY
 */

function qrKeys(): QrKeys {
  const e = env();
  return { current: e.QR_SIGNING_SECRET, previous: e.QR_SIGNING_SECRET_PREVIOUS };
}

// ─── Member side ────────────────────────────────────────────────────────────

export type QrIssueResult = { token: string; expiresAt: string; refreshInSeconds: number };

export async function issueQrForMyTicket(actor: Actor, ticketNumber: string): Promise<QrIssueResult> {
  const memberId = requireMemberActor(actor);
  await enforceRateLimit(`qr:${actor.userId}`, RATE_LIMITS.qrIssuePerUser.limit, RATE_LIMITS.qrIssuePerUser.window);
  const ticket = await db.ticket.findUnique({
    where: { ticketNumber },
    include: { member: { include: { memberships: true } } },
  });
  if (!ticket || ticket.memberId !== memberId) throw notFound("Ticket");

  const status = effectiveTicketStatus(ticket);
  if (status === "REVOKED") throw new AppError("INVALID_STATE", "This ticket has been revoked. Please contact concierge.");
  if (status === "SUSPENDED") throw new AppError("INVALID_STATE", "This ticket is temporarily suspended. Please contact concierge.");
  if (status === "EXPIRED") throw new AppError("INVALID_STATE", "This ticket has expired.");
  const membership = pickCurrentMembership(ticket.member.memberships);
  if (membership?.status !== "ACTIVE") {
    throw new AppError("INVALID_STATE", "Your membership is not active, so access credentials are unavailable. Please contact concierge.");
  }

  let credential = await db.ticketCredential.findFirst({ where: { ticketId: ticket.id, revokedAt: null }, orderBy: { version: "desc" } });
  if (!credential) credential = await db.$transaction((tx) => createCredential(tx, ticket.id, "Auto-created"));

  const ttl = env().QR_TOKEN_TTL_SECONDS;
  const { token, expiresAt } = signQrToken(credential.credentialRef, qrKeys(), ttl);
  return { token, expiresAt: expiresAt.toISOString(), refreshInSeconds: Math.max(20, Math.floor(ttl * 0.6)) };
}

// ─── Staff side ─────────────────────────────────────────────────────────────

export type ScanInput = {
  token?: string;
  ticketNumber?: string;
  zoneId: string;
  deviceInfo?: string | null;
};

export type ZoneAccess = { zoneId: string; name: string; onTicket: boolean; entitled: boolean; checkedIn: boolean };

export type ScanOutcome = {
  scanLogId: string;
  result: ScanResult;
  reason: string;
  message: string;
  severity: ScanSeverity;
  canCheckIn: boolean;
  zone: { id: string; name: string } | null;
  ticket: null | {
    ticketNumber: string;
    typeName: string;
    status: string;
    validFrom: string;
    validUntil: string;
    entryPolicy: string;
  };
  member: null | {
    name: string;
    membershipNumber: string;
    tier: string | null;
    tierTheme: string | null;
    membershipStatus: string | null;
    photoUrl: string | null;
    priority: boolean;
  };
  event: null | { name: string };
  access: ZoneAccess[];
  recentCheckIns: { zone: string; at: string }[];
};

async function logScan(data: {
  staffUserId: string;
  action: ScanAction;
  method: ScanMethod;
  result: ScanResult;
  reason: string;
  ticketId?: string | null;
  memberId?: string | null;
  eventId?: string | null;
  zoneId?: string | null;
  deviceInfo?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  at?: Date;
}) {
  return db.ticketScanLog.create({
    data: {
      scanTime: data.at ?? new Date(),
      staffUserId: data.staffUserId,
      action: data.action,
      method: data.method,
      result: data.result,
      reason: data.reason,
      ticketId: data.ticketId ?? null,
      memberId: data.memberId ?? null,
      eventId: data.eventId ?? null,
      zoneId: data.zoneId ?? null,
      deviceInfo: data.deviceInfo?.slice(0, 300) ?? null,
      metadata: data.metadata ?? {},
    },
  });
}

async function loadTicketContext(ticketId: string) {
  return db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      event: true,
      ticketType: { include: { zones: true } },
      member: { include: { user: { select: { status: true } }, memberships: { include: { tier: true } } } },
      checkIns: { include: { zone: { select: { name: true } } }, orderBy: { checkedInAt: "desc" } },
    },
  });
}

type TicketContext = NonNullable<Awaited<ReturnType<typeof loadTicketContext>>>;

async function decide(ctx: TicketContext, zoneId: string, credential: { revokedAt: Date | null; revokeReason: string | null } | null, now: Date) {
  const zone = await db.accessZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new AppError("VALIDATION", "Choose a checkpoint.");
  const membership = pickCurrentMembership(ctx.member.memberships);
  const entitlements = await getMemberEntitlements(ctx.memberId, db, now);
  const localDate = localDateString(now, ctx.event.timezone);
  const decision: AccessDecision =
    zone.eventId !== ctx.eventId
      ? { result: "WRONG_ACCESS_ZONE", reason: "ZONE_NOT_ON_TICKET", entryKey: null }
      : evaluateAccess({
          now,
          localDate,
          credential,
          ticket: {
            status: ctx.status,
            validFrom: ctx.validFrom,
            validUntil: ctx.validUntil,
            entryPolicy: ctx.ticketType.entryPolicy,
            zoneIds: ctx.ticketType.zones.map((z) => z.zoneId),
          },
          userStatus: ctx.member.user.status,
          membershipStatus: membership?.status ?? null,
          zone: { id: zone.id, active: zone.active, requiredEntitlementCode: zone.requiredEntitlementCode },
          entitlements,
          checkIns: ctx.checkIns.map((c) => ({ zoneId: c.zoneId, localDate: c.localDate })),
        });
  return { decision, zone, membership, entitlements, localDate };
}

async function buildOutcome(
  scanLogId: string,
  result: ScanResult,
  reason: string,
  zone: { id: string; name: string } | null,
  ctx: TicketContext | null,
  entitlements: Record<string, boolean | number | string> = {},
): Promise<ScanOutcome> {
  const message = ACCESS_REASON_MESSAGES[reason as keyof typeof ACCESS_REASON_MESSAGES] ?? reason;
  if (!ctx) {
    return { scanLogId, result, reason, message, severity: scanSeverity(result, reason), canCheckIn: false, zone, ticket: null, member: null, event: null, access: [], recentCheckIns: [] };
  }
  const membership = pickCurrentMembership(ctx.member.memberships);
  const zones = await db.accessZone.findMany({ where: { eventId: ctx.eventId }, orderBy: { sortOrder: "asc" } });
  const ticketZoneIds = ctx.ticketType.zones.map((z) => z.zoneId);
  return {
    scanLogId,
    result,
    reason,
    message,
    severity: scanSeverity(result, reason),
    canCheckIn: result === "VALID",
    zone,
    ticket: {
      ticketNumber: ctx.ticketNumber,
      typeName: ctx.ticketType.name,
      status: effectiveTicketStatus(ctx),
      validFrom: ctx.validFrom.toISOString(),
      validUntil: ctx.validUntil.toISOString(),
      entryPolicy: ctx.ticketType.entryPolicy,
    },
    member: {
      // Minimum verification data only — no contact details for check-in staff.
      name: `${ctx.member.firstName} ${ctx.member.lastName}`,
      membershipNumber: ctx.member.membershipNumber,
      tier: membership?.tier.displayName ?? null,
      tierTheme: membership?.tier.cardTheme ?? null,
      membershipStatus: membership?.status ?? null,
      photoUrl: ctx.member.profilePhotoKey ? `/api/files/${ctx.member.profilePhotoKey}` : null,
      priority: hasEntitlement(entitlements, ENTITLEMENT_CODES.PRIORITY_CHECKIN),
    },
    event: { name: ctx.event.name },
    access: zones
      .filter((z) => z.active)
      .map((z) => ({
        zoneId: z.id,
        name: z.name,
        onTicket: ticketZoneIds.includes(z.id),
        entitled: !z.requiredEntitlementCode || hasEntitlement(entitlements, z.requiredEntitlementCode),
        checkedIn: ctx.checkIns.some((c) => c.zoneId === z.id),
      })),
    recentCheckIns: ctx.checkIns.slice(0, 5).map((c) => ({ zone: c.zone.name, at: c.checkedInAt.toISOString() })),
  };
}

/** Validate a QR token or a manually typed ticket number. Never changes ticket state. */
export async function scan(actor: Actor, input: ScanInput, now = new Date()): Promise<ScanOutcome> {
  requirePermission(actor, "scan:validate");
  await enforceRateLimit(`scan:${actor.userId}`, RATE_LIMITS.scanPerStaff.limit, RATE_LIMITS.scanPerStaff.window);
  const zone = await db.accessZone.findUnique({ where: { id: input.zoneId }, select: { id: true, name: true, eventId: true } });
  if (!zone) throw new AppError("VALIDATION", "Choose a checkpoint before scanning.");
  const zoneRef = { id: zone.id, name: zone.name };
  const method: ScanMethod = input.token ? "QR" : "MANUAL";
  const base = { staffUserId: actor.userId, action: "VALIDATE" as const, method, zoneId: zone.id, deviceInfo: input.deviceInfo, at: now };

  let ticketId: string | null = null;
  let credential: { revokedAt: Date | null; revokeReason: string | null } | null = null;
  let credentialId: string | null = null;

  if (input.token) {
    const verified = verifyQrToken(input.token, qrKeys(), now);
    if (!verified.ok && verified.reason !== "EXPIRED") {
      const reason = verified.reason === "BAD_SIGNATURE" ? "QR_FORGED" : "QR_MALFORMED";
      const log = await logScan({ ...base, result: "INVALID", reason, eventId: zone.eventId });
      return buildOutcome(log.id, "INVALID", reason, zoneRef, null);
    }
    const ref = verified.ok ? verified.credentialRef : verified.credentialRef!;
    const cred = await db.ticketCredential.findUnique({ where: { credentialRef: ref } });
    if (!cred) {
      const log = await logScan({ ...base, result: "INVALID", reason: "UNKNOWN_CREDENTIAL", eventId: zone.eventId });
      return buildOutcome(log.id, "INVALID", "UNKNOWN_CREDENTIAL", zoneRef, null);
    }
    ticketId = cred.ticketId;
    credentialId = cred.id;
    credential = { revokedAt: cred.revokedAt, revokeReason: cred.revokeReason };
    if (!verified.ok) {
      // Genuine but timed-out code: tell staff to have the member refresh (amber).
      const ctx = await loadTicketContext(ticketId);
      const log = await logScan({ ...base, result: "EXPIRED", reason: "QR_EXPIRED", ticketId, memberId: ctx?.memberId, eventId: ctx?.eventId });
      return buildOutcome(log.id, "EXPIRED", "QR_EXPIRED", zoneRef, ctx);
    }
  } else {
    const number = (input.ticketNumber ?? "").trim().toUpperCase();
    const t = number ? await db.ticket.findUnique({ where: { ticketNumber: number }, select: { id: true } }) : null;
    if (!t) {
      const log = await logScan({ ...base, result: "INVALID", reason: "UNKNOWN_TICKET", eventId: zone.eventId, metadata: { lookup: number.slice(0, 40) } });
      return buildOutcome(log.id, "INVALID", "UNKNOWN_TICKET", zoneRef, null);
    }
    ticketId = t.id;
  }

  const ctx = (await loadTicketContext(ticketId))!;
  const { decision, entitlements } = await decide(ctx, zone.id, credential, now);
  const log = await logScan({
    ...base,
    result: decision.result,
    reason: decision.reason,
    ticketId: ctx.id,
    memberId: ctx.memberId,
    eventId: ctx.eventId,
    metadata: { credentialId },
  });
  return buildOutcome(log.id, decision.result, decision.reason, zoneRef, ctx, entitlements);
}

const CHECK_IN_WINDOW_MS = 3 * 60 * 1000;

async function loadValidatedScan(actor: Actor, scanLogId: string, now = new Date()) {
  const scanLog = await db.ticketScanLog.findUnique({ where: { id: scanLogId } });
  if (
    !scanLog ||
    scanLog.staffUserId !== actor.userId ||
    scanLog.action !== "VALIDATE" ||
    now.getTime() - scanLog.scanTime.getTime() > CHECK_IN_WINDOW_MS
  ) {
    throw new AppError("INVALID_STATE", "This scan has timed out. Please scan again.");
  }
  return scanLog;
}

/** Admit the member for a scan that was just validated by the same staff member. */
export async function checkIn(actor: Actor, scanLogId: string, now = new Date()): Promise<ScanOutcome> {
  requirePermission(actor, "scan:check_in");
  const scanLog = await loadValidatedScan(actor, scanLogId, now);
  if (!scanLog.ticketId || !scanLog.zoneId || scanLog.result !== "VALID") {
    throw new AppError("INVALID_STATE", "Only valid scans can be checked in.");
  }
  const ctx = (await loadTicketContext(scanLog.ticketId))!;
  // Re-check the exact credential that was scanned (it may have been revoked since).
  const credentialId = (scanLog.metadata as { credentialId?: string | null }).credentialId;
  const cred = credentialId ? await db.ticketCredential.findUnique({ where: { id: credentialId } }) : null;
  const { decision, zone, localDate, entitlements } = await decide(ctx, scanLog.zoneId, cred && { revokedAt: cred.revokedAt, revokeReason: cred.revokeReason }, now);
  const base = { staffUserId: actor.userId, action: "CHECK_IN" as const, method: scanLog.method, zoneId: zone.id, ticketId: ctx.id, memberId: ctx.memberId, eventId: ctx.eventId, deviceInfo: scanLog.deviceInfo, at: now };

  if (decision.result !== "VALID") {
    // State changed between scan and confirmation (e.g. revoked meanwhile).
    const log = await logScan({ ...base, result: decision.result, reason: decision.reason });
    return buildOutcome(log.id, decision.result, decision.reason, { id: zone.id, name: zone.name }, ctx, entitlements);
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.ticketCheckIn.create({
        data: {
          ticketId: ctx.id,
          zoneId: zone.id,
          staffUserId: actor.userId,
          entryKey: decision.entryKey ?? `multi:${randomToken(8)}`,
          localDate,
          checkedInAt: now,
        },
      });
      const zonesDone = [...new Set([...ctx.checkIns.map((c) => c.zoneId), zone.id])];
      if (isTicketFullyUsed(ctx.ticketType.entryPolicy, ctx.ticketType.zones.map((z) => z.zoneId), zonesDone)) {
        await tx.ticket.update({ where: { id: ctx.id }, data: { status: "USED" } });
      }
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      // Another device admitted this ticket a moment ago.
      const log = await logScan({ ...base, result: "ALREADY_USED", reason: "ALREADY_USED" });
      const fresh = await loadTicketContext(ctx.id);
      return buildOutcome(log.id, "ALREADY_USED", "ALREADY_USED", { id: zone.id, name: zone.name }, fresh, entitlements);
    }
    throw e;
  }

  const log = await logScan({ ...base, result: "VALID", reason: "OK", metadata: { admitted: true } });
  const fresh = await loadTicketContext(ctx.id);
  const outcome = await buildOutcome(log.id, "VALID", "OK", { id: zone.id, name: zone.name }, fresh, entitlements);
  return { ...outcome, canCheckIn: false, message: "Checked in. Welcome to CLUB JOIA 300." };
}

export async function deny(actor: Actor, scanLogId: string, note?: string) {
  requirePermission(actor, "scan:validate");
  const scanLog = await loadValidatedScan(actor, scanLogId);
  await logScan({
    staffUserId: actor.userId,
    action: "DENY",
    method: scanLog.method,
    result: scanLog.result,
    reason: scanLog.reason ?? "DENIED_BY_STAFF",
    ticketId: scanLog.ticketId,
    memberId: scanLog.memberId,
    eventId: scanLog.eventId,
    zoneId: scanLog.zoneId,
    deviceInfo: scanLog.deviceInfo,
    metadata: { note: note?.slice(0, 200) ?? null },
  });
}

// ─── Logs / stats ───────────────────────────────────────────────────────────

export async function listScanLogs(actor: Actor, q: { eventId?: string; result?: ScanResult; action?: ScanAction; zoneId?: string; page?: number } = {}) {
  requirePermission(actor, "scans:view");
  const page = Math.max(q.page ?? 1, 1);
  const where = {
    ...(q.eventId ? { eventId: q.eventId } : {}),
    ...(q.result ? { result: q.result } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.zoneId ? { zoneId: q.zoneId } : {}),
  };
  const [rows, total] = await Promise.all([
    db.ticketScanLog.findMany({
      where,
      orderBy: { scanTime: "desc" },
      skip: (page - 1) * 50,
      take: 50,
      include: {
        ticket: { select: { id: true, ticketNumber: true } },
        member: { select: { id: true, firstName: true, lastName: true, membershipNumber: true } },
        zone: { select: { name: true } },
        staff: { select: { name: true } },
      },
    }),
    db.ticketScanLog.count({ where }),
  ]);
  return { rows, total, page, pageSize: 50 };
}

/** Checkpoints a scanner can choose from (active zones of live/published events). */
export async function listScannerCheckpoints(actor: Actor) {
  requirePermission(actor, "scan:validate");
  const events = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "LIVE"] } },
    orderBy: { startDate: "asc" },
    include: { zones: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  return events.map((e) => ({ eventId: e.id, eventName: e.name, zones: e.zones.map((z) => ({ id: z.id, name: z.name, code: z.code })) }));
}

export async function checkInsToday(actor: Actor, now = new Date()) {
  requirePermission(actor, "scan:validate");
  const zones = await listScannerCheckpoints(actor);
  const tz = (await db.event.findFirst({ where: { id: zones[0]?.eventId } }))?.timezone ?? "UTC";
  return db.ticketCheckIn.count({ where: { localDate: localDateString(now, tz) } });
}
