import "server-only";
import { db, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { humanCode, randomToken } from "@/lib/crypto";
import { pickCurrentMembership } from "@/domain/membership";
import type { EntryPolicy, TicketStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "./audit.service";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { notifyMember } from "./notification.service";

/**
 * TicketService — event tickets as entitlements of membership. A ticket grants access to the
 * zones of its ticket type during its validity window; membership-level entitlements can
 * further gate zones (see AccessZone.requiredEntitlementCode).
 */

// ─── Credentials ────────────────────────────────────────────────────────────

export async function createCredential(tx: Tx, ticketId: string, reason?: string) {
  const latest = await tx.ticketCredential.findFirst({ where: { ticketId }, orderBy: { version: "desc" } });
  await tx.ticketCredential.updateMany({
    where: { ticketId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason ?? "Superseded" },
  });
  return tx.ticketCredential.create({
    data: { ticketId, credentialRef: randomToken(16), version: (latest?.version ?? 0) + 1 },
  });
}

export async function getActiveCredential(ticketId: string) {
  return db.ticketCredential.findFirst({ where: { ticketId, revokedAt: null }, orderBy: { version: "desc" } });
}

// ─── Member views ───────────────────────────────────────────────────────────

const memberTicketInclude = {
  event: { select: { id: true, slug: true, name: true, city: true, venue: true, timezone: true, startDate: true, endDate: true } },
  ticketType: { include: { zones: { include: { zone: { select: { id: true, name: true, code: true } } } } } },
  checkIns: { select: { checkedInAt: true, zone: { select: { name: true } } }, orderBy: { checkedInAt: "desc" as const }, take: 5 },
} satisfies Prisma.TicketInclude;

export type MemberTicket = Prisma.TicketGetPayload<{ include: typeof memberTicketInclude }>;

/** Effective status, treating an ACTIVE ticket past its window as EXPIRED. */
export function effectiveTicketStatus(t: { status: TicketStatus; validUntil: Date }, now = new Date()): TicketStatus {
  return t.status === "ACTIVE" && t.validUntil < now ? "EXPIRED" : t.status;
}

export async function listMyTickets(actor: Actor) {
  const memberId = requireMemberActor(actor);
  const tickets = await db.ticket.findMany({
    where: { memberId },
    orderBy: [{ validFrom: "asc" }],
    include: memberTicketInclude,
  });
  return tickets.map((t) => ({ ...t, effectiveStatus: effectiveTicketStatus(t) }));
}

export async function getMyTicket(actor: Actor, ticketNumber: string) {
  const memberId = requireMemberActor(actor);
  const ticket = await db.ticket.findUnique({ where: { ticketNumber }, include: memberTicketInclude });
  // Same response for "not yours" and "doesn't exist" — no ticket-number probing.
  if (!ticket || ticket.memberId !== memberId) throw notFound("Ticket");
  return { ...ticket, effectiveStatus: effectiveTicketStatus(ticket) };
}

// ─── Admin ──────────────────────────────────────────────────────────────────

function ticketPrefix(event: { metadata: Prisma.JsonValue; slug: string }) {
  const meta = (event.metadata ?? {}) as { ticketPrefix?: string };
  return (meta.ticketPrefix ?? event.slug.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function createTicketTx(
  tx: Tx,
  actor: Actor,
  memberId: string,
  ticketType: { id: string; code: string; eventId: string; validFrom: Date; validUntil: Date; event: { metadata: Prisma.JsonValue; slug: string } },
) {
  const ticket = await tx.ticket.create({
    data: {
      eventId: ticketType.eventId,
      ticketTypeId: ticketType.id,
      memberId,
      ticketNumber: `${ticketPrefix(ticketType.event)}-${ticketType.code}-${humanCode(6)}`,
      validFrom: ticketType.validFrom,
      validUntil: ticketType.validUntil,
      issuedById: actor.userId,
    },
  });
  await createCredential(tx, ticket.id);
  await recordAudit(actor, { action: "ticket.issue", entityType: "ticket", entityId: ticket.id, after: { ticketNumber: ticket.ticketNumber, memberId, ticketTypeId: ticketType.id } }, tx);
  return ticket;
}

export async function issueTicket(actor: Actor, input: { memberId: string; ticketTypeId: string; eventId?: string; notify?: boolean }) {
  requirePermission(actor, "tickets:manage");
  const [member, ticketType] = await Promise.all([
    db.member.findUnique({ where: { id: input.memberId }, include: { memberships: true } }),
    db.ticketType.findUnique({ where: { id: input.ticketTypeId }, include: { event: true } }),
  ]);
  if (!member || member.anonymizedAt) throw notFound("Member");
  if (!ticketType || !ticketType.active) throw new AppError("VALIDATION", "Choose an active ticket type.");
  if (input.eventId && ticketType.eventId !== input.eventId) throw new AppError("VALIDATION", "That ticket type belongs to a different event.");
  const membership = pickCurrentMembership(member.memberships);
  if (!membership || !["ACTIVE", "INVITED"].includes(membership.status)) {
    throw new AppError("INVALID_STATE", "Tickets can only be issued to members with an active or invited membership.");
  }
  const duplicate = await db.ticket.findFirst({
    where: { memberId: member.id, ticketTypeId: ticketType.id, status: { in: ["ACTIVE", "USED", "SUSPENDED"] } },
  });
  if (duplicate) throw new AppError("CONFLICT", `This member already holds ${ticketType.name} (${duplicate.ticketNumber}).`);

  const ticket = await db.$transaction((tx) => createTicketTx(tx, actor, member.id, ticketType));
  if (input.notify !== false) {
    await notifyMember(member.id, {
      title: `${ticketType.name} is ready`,
      body: `Your ${ticketType.name} credential for ${ticketType.event.name} is now available in your wallet.`,
      type: "TICKET",
      url: `/tickets/${ticket.ticketNumber}`,
      eventId: ticketType.eventId,
    });
  }
  return ticket;
}

/** Issue a ticket type to every active member (optionally of one tier) who doesn't hold it yet. */
export async function issueTicketsBulk(actor: Actor, input: { ticketTypeId: string; eventId?: string; tierId?: string | null }) {
  requirePermission(actor, "tickets:manage");
  const ticketType = await db.ticketType.findUnique({ where: { id: input.ticketTypeId }, include: { event: true } });
  if (ticketType && input.eventId && ticketType.eventId !== input.eventId) throw new AppError("VALIDATION", "That ticket type belongs to a different event.");
  if (!ticketType || !ticketType.active) throw new AppError("VALIDATION", "Choose an active ticket type.");
  const members = await db.member.findMany({
    where: {
      anonymizedAt: null,
      memberships: { some: { status: "ACTIVE", ...(input.tierId ? { tierId: input.tierId } : {}) } },
      tickets: { none: { ticketTypeId: ticketType.id, status: { in: ["ACTIVE", "USED", "SUSPENDED"] } } },
    },
    select: { id: true },
  });
  let issued = 0;
  for (const m of members) {
    await db.$transaction((tx) => createTicketTx(tx, actor, m.id, ticketType));
    issued++;
    await notifyMember(m.id, {
      title: `${ticketType.name} is ready`,
      body: `Your ${ticketType.name} credential for ${ticketType.event.name} is now available in your wallet.`,
      type: "TICKET",
      url: "/tickets",
      eventId: ticketType.eventId,
    });
  }
  await recordAudit(actor, { action: "ticket.issue_bulk", entityType: "ticket_type", entityId: ticketType.id, after: { issued, tierId: input.tierId ?? null } });
  return { issued };
}

export async function revokeTicket(actor: Actor, ticketId: string, reason: string) {
  requirePermission(actor, "tickets:manage");
  const before = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!before) throw notFound("Ticket");
  if (before.status === "REVOKED") throw new AppError("INVALID_STATE", "This ticket is already revoked.");
  return db.$transaction(async (tx) => {
    const after = await tx.ticket.update({
      where: { id: ticketId },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: actor.userId, revokeReason: reason },
    });
    await tx.ticketCredential.updateMany({ where: { ticketId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "Ticket revoked" } });
    await recordAudit(actor, { action: "ticket.revoke", entityType: "ticket", entityId: ticketId, before: { status: before.status }, after: { status: after.status, reason } }, tx);
    return after;
  });
}

export async function setTicketSuspended(actor: Actor, ticketId: string, suspended: boolean) {
  requirePermission(actor, "tickets:manage");
  const before = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!before) throw notFound("Ticket");
  if (suspended ? before.status !== "ACTIVE" : before.status !== "SUSPENDED") {
    throw new AppError("INVALID_STATE", suspended ? "Only active tickets can be suspended." : "This ticket is not suspended.");
  }
  const status: TicketStatus = suspended ? "SUSPENDED" : "ACTIVE";
  await db.ticket.update({ where: { id: ticketId }, data: { status } });
  await recordAudit(actor, { action: suspended ? "ticket.suspend" : "ticket.unsuspend", entityType: "ticket", entityId: ticketId, before: { status: before.status }, after: { status } });
}

/** Invalidate any QR codes in circulation (e.g. a screenshot was shared) and mint a new credential. */
export async function reissueCredential(actor: Actor, ticketId: string) {
  requirePermission(actor, "tickets:manage");
  const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket");
  if (ticket.status === "REVOKED") throw new AppError("INVALID_STATE", "Revoked tickets cannot receive a new credential.");
  const cred = await db.$transaction(async (tx) => {
    const c = await createCredential(tx, ticketId, "Reissued by staff");
    await recordAudit(actor, { action: "ticket.credential_reissue", entityType: "ticket", entityId: ticketId, after: { version: c.version } }, tx);
    return c;
  });
  return { version: cred.version };
}

export type TicketSearch = { q?: string; eventId?: string; status?: TicketStatus; ticketTypeId?: string; page?: number };

export async function searchTickets(actor: Actor, s: TicketSearch = {}) {
  requirePermission(actor, "tickets:view");
  const pageSize = 30;
  const page = Math.max(s.page ?? 1, 1);
  const q = s.q?.trim();
  const where: Prisma.TicketWhereInput = {
    ...(s.eventId ? { eventId: s.eventId } : {}),
    ...(s.status ? { status: s.status } : {}),
    ...(s.ticketTypeId ? { ticketTypeId: s.ticketTypeId } : {}),
    ...(q
      ? {
          OR: [
            { ticketNumber: { contains: q } },
            { member: { firstName: { contains: q } } },
            { member: { lastName: { contains: q } } },
            { member: { membershipNumber: { contains: q } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.ticket.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        member: { select: { id: true, firstName: true, lastName: true, membershipNumber: true } },
        ticketType: { select: { name: true, code: true } },
        event: { select: { name: true } },
        _count: { select: { checkIns: true } },
      },
    }),
    db.ticket.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getTicketAdmin(actor: Actor, id: string) {
  requirePermission(actor, "tickets:view");
  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, membershipNumber: true } },
      event: true,
      ticketType: { include: { zones: { include: { zone: true } } } },
      credentials: { orderBy: { version: "desc" } },
      checkIns: { include: { zone: true, staff: { select: { name: true } } }, orderBy: { checkedInAt: "desc" } },
      scanLogs: { include: { zone: true, staff: { select: { name: true } } }, orderBy: { scanTime: "desc" }, take: 50 },
      issuedBy: { select: { name: true } },
      revokedBy: { select: { name: true } },
    },
  });
  if (!ticket) throw notFound("Ticket");
  return { ...ticket, effectiveStatus: effectiveTicketStatus(ticket) };
}

export async function listMemberTicketsAdmin(actor: Actor, memberId: string) {
  requirePermission(actor, "tickets:view");
  const tickets = await db.ticket.findMany({
    where: { memberId },
    orderBy: { validFrom: "asc" },
    include: { ticketType: { select: { name: true } }, event: { select: { name: true } }, _count: { select: { checkIns: true } } },
  });
  return tickets.map((t) => ({ ...t, effectiveStatus: effectiveTicketStatus(t) }));
}

export async function listTicketTypes(eventId?: string) {
  return db.ticketType.findMany({
    where: eventId ? { eventId } : {},
    orderBy: [{ eventId: "asc" }, { sortOrder: "asc" }],
    include: { event: { select: { name: true } }, zones: { include: { zone: true } }, _count: { select: { tickets: true } } },
  });
}

export type TicketTypeInput = {
  id?: string;
  code: string;
  name: string;
  description: string | null;
  validFrom: Date;
  validUntil: Date;
  entryPolicy: EntryPolicy;
  active: boolean;
  zoneIds: string[];
};

export async function upsertTicketType(actor: Actor, eventId: string, input: TicketTypeInput) {
  requirePermission(actor, "events:manage");
  if (input.validUntil <= input.validFrom) throw new AppError("VALIDATION", "Valid until must be after valid from.");
  const zones = await db.accessZone.findMany({ where: { id: { in: input.zoneIds }, eventId } });
  if (zones.length !== input.zoneIds.length) throw new AppError("VALIDATION", "Unknown access zone.");
  const data = {
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    entryPolicy: input.entryPolicy,
    active: input.active,
  };
  const tt = await db.$transaction(async (tx) => {
    const saved = input.id
      ? await tx.ticketType.update({ where: { id: input.id, eventId }, data })
      : await tx.ticketType.create({ data: { ...data, eventId } });
    await tx.ticketTypeZone.deleteMany({ where: { ticketTypeId: saved.id } });
    await tx.ticketTypeZone.createMany({ data: input.zoneIds.map((zoneId) => ({ ticketTypeId: saved.id, zoneId })) });
    await recordAudit(actor, { action: input.id ? "ticket_type.update" : "ticket_type.create", entityType: "ticket_type", entityId: saved.id, after: { ...saved, zoneIds: input.zoneIds } }, tx);
    return saved;
  });
  return tt;
}
