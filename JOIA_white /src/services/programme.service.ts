import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { hasEntitlement } from "@/domain/entitlements";
import { dateOnly, eachDay, HHMM, localDateString, parseDateOnly, zonedToUtc } from "@/lib/time";
import type { ProgramCategory, ProgramVisibility } from "@/generated/prisma/enums";
import { storedImageUrl } from "@/lib/files";
import { isProgrammeIconKey } from "@/domain/programme-icons";
import { recordAudit } from "./audit.service";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { getMemberEntitlements } from "./entitlement.service";
import { MEMBER_VISIBLE_EVENT_STATUSES } from "./event.service";

/**
 * ProgrammeService — the event timetable. Every time shown to members comes from here
 * (never hardcoded in UI). Times are local wall-clock in the event timezone.
 */

export type ProgrammeItemView = {
  id: string;
  date: string;
  startTime: string;
  endTime: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  location: string | null;
  category: ProgramCategory;
  icon: string | null;
  /** URL of the uploaded image (already resolved), or null. */
  image: string | null;
  restricted: boolean;
  isSample: boolean;
  favorite: boolean;
  startsAt: string; // ISO instant
  endsAt: string | null;
};

type ItemRow = Awaited<ReturnType<typeof db.eventProgramItem.findMany>>[number];

function toView(item: ItemRow, timezone: string, favorite: boolean): ProgrammeItemView {
  const date = dateOnly(item.date);
  let endsAt: Date | null = null;
  if (item.endTime) {
    endsAt = zonedToUtc(date, item.endTime, timezone);
    // An end time earlier than the start (e.g. 22:00–02:00) runs past midnight.
    if (item.endTime < item.startTime) endsAt = new Date(endsAt.getTime() + 86_400_000);
  }
  return {
    id: item.id,
    date,
    startTime: item.startTime,
    endTime: item.endTime,
    title: item.title,
    subtitle: item.subtitle,
    description: item.description,
    location: item.location,
    category: item.category,
    icon: item.icon,
    image: storedImageUrl(item.image),
    restricted: item.visibility === "RESTRICTED",
    isSample: item.isSample,
    favorite,
    startsAt: zonedToUtc(date, item.startTime, timezone).toISOString(),
    endsAt: endsAt?.toISOString() ?? null,
  };
}

/** Programme as the signed-in member may see it, grouped by day. */
export async function getMemberProgramme(actor: Actor, eventId: string) {
  const memberId = requireMemberActor(actor);
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event || !MEMBER_VISIBLE_EVENT_STATUSES.includes(event.status)) throw notFound("Event");
  const [items, favorites, entitlements] = await Promise.all([
    db.eventProgramItem.findMany({
      where: { eventId, visibility: { in: ["MEMBERS", "RESTRICTED"] } },
      orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { startTime: "asc" }],
    }),
    db.memberProgramFavorite.findMany({ where: { memberId, programItem: { eventId } }, select: { programItemId: true } }),
    getMemberEntitlements(memberId),
  ]);
  const favSet = new Set(favorites.map((f) => f.programItemId));
  const visible = items.filter(
    (i) => i.visibility === "MEMBERS" || (i.requiredEntitlementCode && hasEntitlement(entitlements, i.requiredEntitlementCode)),
  );
  const days = eachDay(dateOnly(event.startDate), dateOnly(event.endDate));
  return {
    timezone: event.timezone,
    days: days.map((date) => ({
      date,
      items: visible.filter((i) => dateOnly(i.date) === date).map((i) => toView(i, event.timezone, favSet.has(i.id))),
    })),
  };
}

/** Non-personalised public programme (no restricted items) — used for the offline cache. */
export async function getPublicProgramme(eventSlug: string) {
  const event = await db.event.findUnique({ where: { slug: eventSlug } });
  if (!event || !MEMBER_VISIBLE_EVENT_STATUSES.includes(event.status)) return null;
  const items = await db.eventProgramItem.findMany({
    where: { eventId: event.id, visibility: "MEMBERS" },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { startTime: "asc" }],
  });
  return {
    event: { slug: event.slug, name: event.name, timezone: event.timezone, start: dateOnly(event.startDate), end: dateOnly(event.endDate) },
    items: items.map((i) => toView(i, event.timezone, false)),
  };
}

/** Today's remaining items and the next upcoming item, for the home screen. */
export function summariseProgramme(
  programme: { timezone: string; days: { date: string; items: ProgrammeItemView[] }[] },
  now = new Date(),
) {
  const today = localDateString(now, programme.timezone);
  const all = programme.days.flatMap((d) => d.items);
  const todays = programme.days.find((d) => d.date === today)?.items ?? [];
  const next = all.find((i) => new Date(i.endsAt ?? i.startsAt) > now) ?? null;
  return { today, todays, next };
}

export async function toggleFavorite(actor: Actor, programItemId: string) {
  const memberId = requireMemberActor(actor);
  const item = await db.eventProgramItem.findUnique({ where: { id: programItemId } });
  if (!item || item.visibility === "DRAFT") throw notFound("Programme item");
  const key = { memberId_programItemId: { memberId, programItemId } };
  const existing = await db.memberProgramFavorite.findUnique({ where: key });
  if (existing) {
    await db.memberProgramFavorite.delete({ where: key });
    return { favorite: false };
  }
  await db.memberProgramFavorite.create({ data: { memberId, programItemId } });
  return { favorite: true };
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function listProgrammeAdmin(actor: Actor, eventId: string) {
  requirePermission(actor, "programme:manage");
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFound("Event");
  const items = await db.eventProgramItem.findMany({
    where: { eventId },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { startTime: "asc" }],
    include: { _count: { select: { favorites: true } } },
  });
  return {
    event: { ...event, start: dateOnly(event.startDate), end: dateOnly(event.endDate) },
    days: eachDay(dateOnly(event.startDate), dateOnly(event.endDate)),
    items: items.map((i) => ({ ...i, date: dateOnly(i.date), favorites: i._count.favorites })),
  };
}

export type ProgrammeItemInput = {
  date: string;
  startTime: string;
  endTime: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  location: string | null;
  category: ProgramCategory;
  icon: string | null;
  /** Storage key of an uploaded image; undefined leaves the current image unchanged. */
  image?: string | null;
  visibility: ProgramVisibility;
  requiredEntitlementCode: string | null;
  capacity: number | null;
};

async function validateItem(eventId: string, input: ProgrammeItemInput) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFound("Event");
  if (input.date < dateOnly(event.startDate) || input.date > dateOnly(event.endDate)) {
    throw new AppError("VALIDATION", "The date must fall within the event dates.", { date: ["Outside the event dates."] });
  }
  if (!HHMM.test(input.startTime) || (input.endTime && !HHMM.test(input.endTime))) {
    throw new AppError("VALIDATION", "Times must be in 24-hour HH:MM format.");
  }
  if (input.icon && !isProgrammeIconKey(input.icon)) throw new AppError("VALIDATION", "Unknown icon.");
  if (input.visibility === "RESTRICTED" && !input.requiredEntitlementCode) {
    throw new AppError("VALIDATION", "Restricted items need an entitlement.", { requiredEntitlementCode: ["Choose an entitlement."] });
  }
  if (input.requiredEntitlementCode && !(await db.entitlement.findUnique({ where: { code: input.requiredEntitlementCode } }))) {
    throw new AppError("VALIDATION", "Unknown entitlement.");
  }
  return event;
}

export async function createProgrammeItem(actor: Actor, eventId: string, input: ProgrammeItemInput) {
  requirePermission(actor, "programme:manage");
  await validateItem(eventId, input);
  const last = await db.eventProgramItem.findFirst({
    where: { eventId, date: parseDateOnly(input.date) },
    orderBy: { sortOrder: "desc" },
  });
  const item = await db.eventProgramItem.create({
    data: { ...input, eventId, date: parseDateOnly(input.date), sortOrder: (last?.sortOrder ?? 0) + 10 },
  });
  await recordAudit(actor, { action: "programme.create", entityType: "programme_item", entityId: item.id, after: item });
  return item;
}

export async function updateProgrammeItem(actor: Actor, id: string, input: ProgrammeItemInput) {
  requirePermission(actor, "programme:manage");
  const before = await db.eventProgramItem.findUnique({ where: { id } });
  if (!before) throw notFound("Programme item");
  await validateItem(before.eventId, input);
  const after = await db.eventProgramItem.update({
    where: { id },
    data: { ...input, date: parseDateOnly(input.date), isSample: false },
  });
  await recordAudit(actor, { action: "programme.update", entityType: "programme_item", entityId: id, before, after });
  return after;
}

export async function deleteProgrammeItem(actor: Actor, id: string) {
  requirePermission(actor, "programme:manage");
  const before = await db.eventProgramItem.findUnique({ where: { id } });
  if (!before) throw notFound("Programme item");
  await db.eventProgramItem.delete({ where: { id } });
  await recordAudit(actor, { action: "programme.delete", entityType: "programme_item", entityId: id, before });
}

export async function setProgrammeVisibility(actor: Actor, id: string, visibility: ProgramVisibility) {
  requirePermission(actor, "programme:manage");
  const before = await db.eventProgramItem.findUnique({ where: { id } });
  if (!before) throw notFound("Programme item");
  if (visibility === "RESTRICTED" && !before.requiredEntitlementCode) {
    throw new AppError("VALIDATION", "Set an entitlement on the item before restricting it.");
  }
  await db.eventProgramItem.update({ where: { id }, data: { visibility } });
  await recordAudit(actor, {
    action: visibility === "DRAFT" ? "programme.unpublish" : "programme.publish",
    entityType: "programme_item",
    entityId: id,
    before: { visibility: before.visibility },
    after: { visibility },
  });
}

/** Move an item up/down within its day by swapping sort order with its neighbour. */
export async function moveProgrammeItem(actor: Actor, id: string, direction: "up" | "down") {
  requirePermission(actor, "programme:manage");
  const item = await db.eventProgramItem.findUnique({ where: { id } });
  if (!item) throw notFound("Programme item");
  const siblings = await db.eventProgramItem.findMany({
    where: { eventId: item.eventId, date: item.date },
    orderBy: [{ sortOrder: "asc" }, { startTime: "asc" }],
  });
  const idx = siblings.findIndex((s) => s.id === id);
  const swapWith = siblings[direction === "up" ? idx - 1 : idx + 1];
  if (!swapWith) return;
  // Normalise to 10-step spacing then swap, so equal sort orders can't get stuck.
  const ordered = siblings.map((s) => s.id);
  [ordered[idx], ordered[ordered.indexOf(swapWith.id)]] = [swapWith.id, id];
  await db.$transaction(ordered.map((sid, i) => db.eventProgramItem.update({ where: { id: sid }, data: { sortOrder: (i + 1) * 10 } })));
  await recordAudit(actor, { action: "programme.reorder", entityType: "programme_item", entityId: id, after: { direction } });
}
