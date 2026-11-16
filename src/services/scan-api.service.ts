import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { localDateString } from "@/lib/time";
import { entryKeyFor, isTicketFullyUsed } from "@/domain/access";
import { pickCurrentMembership } from "@/domain/membership";
import { recordAudit } from "./audit.service";
import { effectiveTicketStatus } from "./ticket.service";

/**
 * Scanner API (src/app/api/scan): an outside door scanner reads every ticket and marks one
 * scanned by its ticket number, with an API key instead of a staff sign-in (SCAN_API_KEY).
 *
 * "Scanned" means the ticket has a check-in, the same record the staff scanner app makes, so the
 * admin pages (Scans, audit) show both alike. An API scan admits the ticket at its first zone and
 * is logged as a manual CHECK_IN by the "Scanner API" user (made on first use, disabled: it can't
 * sign in). It skips the door rules of the staff scanner (day, zone, entitlements); revoked and
 * suspended tickets are refused. Setting scanned to 0 removes the ticket's check-ins (a scan by
 * mistake) and is written to the audit log.
 */

export const SCAN_API_USER_EMAIL = "scanner-api@system.invalid";

export type ScanRecord = {
  ticketId: string;
  name: string;
  email: string;
  phone: string | null;
  type: string;
  typeName: string;
  tier: string | null;
  status: string;
  scanned: 0 | 1;
  timeScanned: string | null;
};

export type ScanAnswer = { ticketId: string; scanned: 0 | 1; timeScanned: string | null; alreadyScanned?: boolean };

export type Caller = { ipAddress?: string | null; userAgent?: string | null };

const recordInclude = {
  ticketType: { select: { code: true, name: true } },
  member: {
    select: {
      firstName: true,
      lastName: true,
      mobile: true,
      user: { select: { email: true } },
      memberships: { select: { status: true, issueDate: true, endDate: true, tier: { select: { displayName: true } } } },
    },
  },
  checkIns: { select: { checkedInAt: true }, orderBy: { checkedInAt: "asc" as const }, take: 1 },
};

type TicketRow = NonNullable<Awaited<ReturnType<typeof findTicket>>>;

function findTicket(ticketNumber: string) {
  return db.ticket.findUnique({ where: { ticketNumber: normalise(ticketNumber) }, include: recordInclude });
}

function normalise(ticketNumber: string): string {
  return ticketNumber.trim().toUpperCase().slice(0, 64);
}

function toRecord(t: TicketRow, now: Date): ScanRecord {
  const first = t.checkIns[0]?.checkedInAt ?? null;
  return {
    ticketId: t.ticketNumber,
    name: `${t.member.firstName} ${t.member.lastName}`.trim(),
    email: t.member.user.email,
    phone: t.member.mobile,
    type: t.ticketType.code,
    typeName: t.ticketType.name,
    tier: pickCurrentMembership(t.member.memberships)?.tier.displayName ?? null,
    status: effectiveTicketStatus(t, now),
    scanned: first ? 1 : 0,
    timeScanned: first ? first.toISOString() : null,
  };
}

/** Every ticket, oldest event and ticket first. */
export async function listScanRecords(now = new Date()): Promise<ScanRecord[]> {
  const tickets = await db.ticket.findMany({
    include: recordInclude,
    orderBy: [{ validFrom: "asc" }, { ticketNumber: "asc" }],
  });
  return tickets.map((t) => toRecord(t, now));
}

export async function getScanRecord(ticketNumber: string, now = new Date()): Promise<ScanRecord> {
  const t = await findTicket(ticketNumber);
  if (!t) throw notFound("Ticket");
  return toRecord(t, now);
}

/** The user the API's scans are made by: a disabled staff account without a password. */
async function apiUserId(): Promise<string> {
  const user = await db.user.upsert({
    where: { email: SCAN_API_USER_EMAIL },
    update: {},
    create: { email: SCAN_API_USER_EMAIL, name: "Scanner API", role: "CHECK_IN_STAFF", status: "DISABLED" },
    select: { id: true },
  });
  return user.id;
}

export async function setScanned(ticketNumber: string, scanned: 0 | 1, caller: Caller = {}, now = new Date()): Promise<ScanAnswer> {
  const t = await db.ticket.findUnique({
    where: { ticketNumber: normalise(ticketNumber) },
    include: {
      event: { select: { timezone: true } },
      ticketType: { include: { zones: { include: { zone: true } } } },
      checkIns: { orderBy: { checkedInAt: "asc" } },
    },
  });
  if (!t) throw notFound("Ticket");
  const userId = await apiUserId();
  const actor = { userId, ipAddress: caller.ipAddress ?? null, userAgent: caller.userAgent ?? null };

  if (scanned === 0) {
    if (t.checkIns.length === 0) return { ticketId: t.ticketNumber, scanned: 0, timeScanned: null };
    await db.$transaction(async (tx) => {
      await tx.ticketCheckIn.deleteMany({ where: { ticketId: t.id } });
      if (t.status === "USED") await tx.ticket.update({ where: { id: t.id }, data: { status: "ACTIVE" } });
      await recordAudit(
        actor,
        {
          action: "scan_api.unscanned",
          entityType: "Ticket",
          entityId: t.id,
          before: { ticketNumber: t.ticketNumber, status: t.status, checkIns: t.checkIns.map((c) => ({ zoneId: c.zoneId, at: c.checkedInAt.toISOString() })) },
          after: { status: t.status === "USED" ? "ACTIVE" : t.status, checkIns: [] },
        },
        tx,
      );
    });
    return { ticketId: t.ticketNumber, scanned: 0, timeScanned: null };
  }

  if (t.checkIns.length > 0) {
    return { ticketId: t.ticketNumber, scanned: 1, timeScanned: t.checkIns[0].checkedInAt.toISOString(), alreadyScanned: true };
  }
  const status = effectiveTicketStatus(t, now);
  if (status === "REVOKED") throw new AppError("INVALID_STATE", "This ticket has been revoked.");
  if (status === "SUSPENDED") throw new AppError("INVALID_STATE", "This ticket is suspended.");

  const zones = t.ticketType.zones.map((z) => z.zone).sort((a, b) => a.sortOrder - b.sortOrder);
  const zone = zones.find((z) => z.active) ?? zones[0];
  if (!zone) throw new AppError("INVALID_STATE", "This ticket type has no access zone to check in to.");
  const localDate = localDateString(now, t.event.timezone);

  try {
    await db.$transaction(async (tx) => {
      await tx.ticketCheckIn.create({
        data: {
          ticketId: t.id,
          zoneId: zone.id,
          staffUserId: userId,
          // the staff scanner's key for this entry policy, so it sees the ticket as used; one API scan otherwise
          entryKey: entryKeyFor(t.ticketType.entryPolicy, localDate) ?? "api",
          localDate,
          checkedInAt: now,
        },
      });
      if (isTicketFullyUsed(t.ticketType.entryPolicy, t.ticketType.zones.map((z) => z.zoneId), [zone.id])) {
        await tx.ticket.update({ where: { id: t.id }, data: { status: "USED" } });
      }
      await tx.ticketScanLog.create({
        data: {
          scanTime: now,
          staffUserId: userId,
          action: "CHECK_IN",
          method: "MANUAL",
          result: "VALID",
          reason: "OK",
          ticketId: t.id,
          memberId: t.memberId,
          eventId: t.eventId,
          zoneId: zone.id,
          deviceInfo: caller.userAgent?.slice(0, 300) ?? null,
          metadata: { admitted: true, via: "scan_api" },
        },
      });
    });
  } catch (e) {
    // another call scanned it a moment ago
    if ((e as { code?: string }).code === "P2002") {
      const first = await db.ticketCheckIn.findFirst({ where: { ticketId: t.id }, orderBy: { checkedInAt: "asc" } });
      return { ticketId: t.ticketNumber, scanned: 1, timeScanned: first?.checkedInAt.toISOString() ?? now.toISOString(), alreadyScanned: true };
    }
    throw e;
  }
  return { ticketId: t.ticketNumber, scanned: 1, timeScanned: now.toISOString() };
}
