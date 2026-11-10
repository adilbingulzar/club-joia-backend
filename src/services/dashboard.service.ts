import "server-only";
import { db } from "@/lib/db";
import { localDateString } from "@/lib/time";
import { requirePermission, type Actor } from "./context";
import { getFeaturedEvent } from "./event.service";

/** DashboardService — operational statistics for /admin. */
export async function getDashboardStats(actor: Actor, now = new Date()) {
  requirePermission(actor, "dashboard:view");
  const event = await getFeaturedEvent(now);
  const today = localDateString(now, event?.timezone ?? "Asia/Dubai");

  const [
    totalMembers,
    activeMembers,
    tierCounts,
    tiers,
    ticketsIssued,
    checkedInToday,
    pendingConcierge,
    notificationsSent,
    pendingActivation,
    deletionRequests,
    recentScans,
    eventCounts,
    ticketTypes,
    ticketTypeCounts,
  ] = await Promise.all([
    db.member.count({ where: { anonymizedAt: null } }),
    db.member.count({ where: { anonymizedAt: null, memberships: { some: { status: "ACTIVE" } } } }),
    db.membership.groupBy({ by: ["tierId"], where: { status: "ACTIVE" }, _count: true }),
    db.membershipTier.findMany({ orderBy: { sortOrder: "asc" } }),
    db.ticket.count({ where: { status: { in: ["ACTIVE", "USED"] } } }),
    db.ticketCheckIn.count({ where: { localDate: today } }),
    db.conciergeRequest.count({ where: { status: { in: ["NEW", "IN_PROGRESS", "WAITING_FOR_MEMBER"] } } }),
    db.notification.count({ where: { status: "SENT" } }),
    db.user.count({ where: { role: "MEMBER", status: "PENDING_ACTIVATION" } }),
    db.member.count({ where: { deletionRequestedAt: { not: null }, anonymizedAt: null } }),
    db.ticketScanLog.findMany({
      orderBy: { scanTime: "desc" },
      take: 8,
      include: { member: { select: { firstName: true, lastName: true } }, zone: { select: { name: true } } },
    }),
    db.event.groupBy({ by: ["status"], _count: true }),
    db.ticketType.findMany({
      orderBy: [{ event: { startDate: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, code: true, active: true, event: { select: { id: true, name: true } } },
    }),
    db.ticket.groupBy({ by: ["ticketTypeId", "status"], _count: true }),
  ]);

  const countFor = (ticketTypeId: string, statuses: string[]) =>
    ticketTypeCounts.filter((c) => c.ticketTypeId === ticketTypeId && statuses.includes(c.status)).reduce((n, c) => n + c._count, 0);
  const byEvent = new Map<string, { eventId: string; eventName: string; types: { id: string; name: string; code: string; active: boolean; issued: number; used: number; revoked: number }[] }>();
  for (const t of ticketTypes) {
    const g = byEvent.get(t.event.id) ?? { eventId: t.event.id, eventName: t.event.name, types: [] };
    g.types.push({ id: t.id, name: t.name, code: t.code, active: t.active, issued: countFor(t.id, ["ACTIVE", "USED", "SUSPENDED"]), used: countFor(t.id, ["USED"]), revoked: countFor(t.id, ["REVOKED"]) });
    byEvent.set(t.event.id, g);
  }
  const events = {
    total: eventCounts.reduce((n, c) => n + c._count, 0),
    live: eventCounts.filter((c) => c.status === "PUBLISHED" || c.status === "LIVE").reduce((n, c) => n + c._count, 0),
    draft: eventCounts.find((c) => c.status === "DRAFT")?._count ?? 0,
  };

  return {
    event,
    today,
    totalMembers,
    activeMembers,
    tiers: tiers.map((t) => ({ id: t.id, name: t.displayName, color: t.color, theme: t.cardTheme, count: tierCounts.find((c) => c.tierId === t.id)?._count ?? 0 })),
    ticketsIssued,
    checkedInToday,
    pendingConcierge,
    notificationsSent,
    pendingActivation,
    deletionRequests,
    recentScans,
    events,
    ticketTypeCount: ticketTypes.length,
    ticketTypesByEvent: [...byEvent.values()],
  };
}
