import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { dateOnly, eachDay, parseDateOnly } from "@/lib/time";
import type { EventStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { storedImageUrl } from "@/lib/files";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * EventService — the reusable global events model. Abu Dhabi 2026 is simply the first row;
 * Monaco / Miami / Singapore will be additional rows (optionally under their own chapter).
 */

export const MEMBER_VISIBLE_EVENT_STATUSES: EventStatus[] = ["PUBLISHED", "LIVE", "COMPLETED"];

export type EventInfo = {
  /** Short hero line, e.g. "Grand Prix Weekend". */
  tagline?: string;
  /** Prefix of ticket numbers, e.g. "AD26" → AD26-FRI-XXXXXX. */
  ticketPrefix?: string;
  supportEmail?: string;
  supportPhone?: string;
  dressCode?: string;
  infoSections?: { title: string; body: string }[];
};

function shape<T extends { startDate: Date; endDate: Date; metadata: Prisma.JsonValue }>(e: T) {
  const start = dateOnly(e.startDate);
  const end = dateOnly(e.endDate);
  const heroImage = (e as { heroImage?: string | null }).heroImage;
  return { ...e, start, end, days: eachDay(start, end), info: (e.metadata ?? {}) as EventInfo, heroImageUrl: storedImageUrl(heroImage) };
}

export async function listMemberEvents() {
  const events = await db.event.findMany({
    where: { status: { in: MEMBER_VISIBLE_EVENT_STATUSES } },
    orderBy: { startDate: "asc" },
    include: { chapter: true },
  });
  return events.map(shape);
}

export async function getMemberEventBySlug(slug: string) {
  const event = await db.event.findUnique({ where: { slug }, include: { chapter: true } });
  if (!event || !MEMBER_VISIBLE_EVENT_STATUSES.includes(event.status)) return null;
  return shape(event);
}

/** The event to feature on the member home screen: the next live/upcoming one. */
export async function getFeaturedEvent(now = new Date()) {
  const today = parseDateOnly(dateOnly(now));
  const upcoming = await db.event.findFirst({
    where: { status: { in: ["PUBLISHED", "LIVE"] }, endDate: { gte: today } },
    orderBy: { startDate: "asc" },
    include: { chapter: true },
  });
  return upcoming ? shape(upcoming) : null;
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function listEventsAdmin(actor: Actor) {
  requirePermission(actor, "programme:manage");
  const events = await db.event.findMany({
    orderBy: { startDate: "desc" },
    include: {
      chapter: true,
      _count: { select: { programItems: true, tickets: true, zones: true, ticketTypes: true } },
    },
  });
  return events.map(shape);
}

export async function getEventAdmin(actor: Actor, id: string) {
  requirePermission(actor, "programme:manage");
  const event = await db.event.findUnique({
    where: { id },
    include: {
      chapter: true,
      zones: { orderBy: { sortOrder: "asc" } },
      ticketTypes: { orderBy: { sortOrder: "asc" }, include: { zones: { include: { zone: true } }, _count: { select: { tickets: true } } } },
    },
  });
  if (!event) throw notFound("Event");
  return shape(event);
}

export type EventUpdateInput = {
  name: string;
  venue: string;
  city: string;
  country: string;
  timezone: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  description: string | null;
  /** Storage key of an uploaded image; undefined leaves the current image unchanged. */
  heroImage?: string | null;
  info: EventInfo;
};

function assertTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new AppError("VALIDATION", "Unknown timezone. Use an IANA name such as Asia/Dubai.");
  }
}

/** Event configuration is a SUPER_ADMIN capability ("events:manage"). */
export async function updateEvent(actor: Actor, id: string, input: EventUpdateInput) {
  requirePermission(actor, "events:manage");
  assertTimezone(input.timezone);
  if (input.endDate < input.startDate) throw new AppError("VALIDATION", "End date must be on or after the start date.");
  if (input.info.ticketPrefix !== undefined) input.info.ticketPrefix = normalizePrefix(input.info.ticketPrefix);
  const before = await db.event.findUnique({ where: { id } });
  if (!before) throw notFound("Event");
  const after = await db.event.update({
    where: { id },
    data: {
      name: input.name,
      venue: input.venue,
      city: input.city,
      country: input.country,
      timezone: input.timezone,
      startDate: parseDateOnly(input.startDate),
      endDate: parseDateOnly(input.endDate),
      status: input.status,
      description: input.description,
      heroImage: input.heroImage,
      metadata: { ...((before.metadata ?? {}) as object), ...input.info } as Prisma.InputJsonValue,
    },
  });
  await recordAudit(actor, { action: "event.update", entityType: "event", entityId: id, before, after });
  return after;
}

export async function upsertZone(
  actor: Actor,
  eventId: string,
  input: { id?: string; code: string; name: string; description?: string | null; requiredEntitlementCode?: string | null; active: boolean },
) {
  requirePermission(actor, "events:manage");
  if (input.requiredEntitlementCode) {
    const ent = await db.entitlement.findUnique({ where: { code: input.requiredEntitlementCode } });
    if (!ent) throw new AppError("VALIDATION", "Unknown entitlement code.");
  }
  const data = {
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description ?? null,
    requiredEntitlementCode: input.requiredEntitlementCode || null,
    active: input.active,
  };
  const zone = input.id
    ? await db.accessZone.update({ where: { id: input.id, eventId }, data })
    : await db.accessZone.create({ data: { ...data, eventId } });
  await recordAudit(actor, { action: input.id ? "zone.update" : "zone.create", entityType: "access_zone", entityId: zone.id, after: zone });
  return zone;
}

export async function listZones(eventId: string) {
  return db.accessZone.findMany({ where: { eventId, active: true }, orderBy: { sortOrder: "asc" } });
}

function normalizePrefix(p: string | undefined) {
  const v = (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return v || undefined;
}

export function slugify(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export type EventCreateInput = Omit<EventUpdateInput, "status"> & {
  slug?: string | null;
  chapterId?: string | null;
  /** Copy zones, ticket types (validity shifted to the new dates) and — optionally — the programme as drafts. */
  cloneFromEventId?: string | null;
  cloneProgramme?: boolean;
};

const DAY_MS = 86_400_000;

/** Creates a new event (always as DRAFT, so members don't see it until it is published). */
export async function createEvent(actor: Actor, input: EventCreateInput) {
  requirePermission(actor, "events:manage");
  assertTimezone(input.timezone);
  if (input.endDate < input.startDate) throw new AppError("VALIDATION", "End date must be on or after the start date.", { endDate: ["Before the start date."] });
  const slug = slugify(input.slug || `${input.name}`);
  if (!slug) throw new AppError("VALIDATION", "Enter a name that contains letters or numbers.", { name: ["Required."] });
  if (await db.event.findUnique({ where: { slug } })) {
    throw new AppError("CONFLICT", "An event with this web address already exists.", { slug: ["Already in use — choose another."] });
  }
  if (input.chapterId && !(await db.chapter.findUnique({ where: { id: input.chapterId } }))) throw new AppError("VALIDATION", "Unknown chapter.");
  const source = input.cloneFromEventId
    ? await db.event.findUnique({
        where: { id: input.cloneFromEventId },
        include: { zones: true, ticketTypes: { include: { zones: true } }, programItems: true },
      })
    : null;
  if (input.cloneFromEventId && !source) throw notFound("Event to copy");

  const info = { ...input.info, ticketPrefix: normalizePrefix(input.info.ticketPrefix) ?? normalizePrefix(slug.replace(/-/g, "").slice(0, 4)) };
  const startDate = parseDateOnly(input.startDate);
  const endDate = parseDateOnly(input.endDate);
  const shift = source ? startDate.getTime() - source.startDate.getTime() : 0;

  const event = await db.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        slug,
        name: input.name,
        venue: input.venue,
        city: input.city,
        country: input.country,
        timezone: input.timezone,
        startDate,
        endDate,
        status: "DRAFT",
        description: input.description,
        heroImage: input.heroImage ?? null,
        chapterId: input.chapterId || null,
        metadata: JSON.parse(JSON.stringify(info)) as Prisma.InputJsonValue,
      },
    });
    if (source) {
      const zoneMap = new Map<string, string>();
      for (const z of source.zones) {
        const nz = await tx.accessZone.create({
          data: { eventId: created.id, code: z.code, name: z.name, description: z.description, requiredEntitlementCode: z.requiredEntitlementCode, active: z.active, sortOrder: z.sortOrder },
        });
        zoneMap.set(z.id, nz.id);
      }
      for (const t of source.ticketTypes) {
        const nt = await tx.ticketType.create({
          data: {
            eventId: created.id, code: t.code, name: t.name, description: t.description, entryPolicy: t.entryPolicy, active: t.active, sortOrder: t.sortOrder,
            validFrom: new Date(t.validFrom.getTime() + shift), validUntil: new Date(t.validUntil.getTime() + shift),
          },
        });
        await tx.ticketTypeZone.createMany({ data: t.zones.filter((z) => zoneMap.has(z.zoneId)).map((z) => ({ ticketTypeId: nt.id, zoneId: zoneMap.get(z.zoneId)! })) });
      }
      if (input.cloneProgramme) {
        const items = source.programItems
          .map((i) => ({ ...i, newDate: new Date(i.date.getTime() + Math.round(shift / DAY_MS) * DAY_MS) }))
          .filter((i) => i.newDate >= startDate && i.newDate <= endDate);
        await tx.eventProgramItem.createMany({
          data: items.map((i) => ({
            eventId: created.id, date: i.newDate, startTime: i.startTime, endTime: i.endTime, title: i.title, subtitle: i.subtitle, description: i.description,
            location: i.location, category: i.category, icon: i.icon, image: i.image, visibility: "DRAFT" as const, requiredEntitlementCode: i.requiredEntitlementCode,
            sortOrder: i.sortOrder, capacity: i.capacity, isSample: i.isSample,
          })),
        });
      }
    }
    await recordAudit(actor, { action: "event.create", entityType: "event", entityId: created.id, after: { ...created, clonedFrom: source?.id ?? null } }, tx);
    return created;
  });
  return event;
}

export async function listChapters() {
  return db.chapter.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}
