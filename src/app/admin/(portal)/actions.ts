"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction, formToObject } from "@/lib/actions";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { zonedToUtc } from "@/lib/time";
import type { AdminFormState } from "@/components/admin/action-controls";
import { issuePasswordResetLink } from "@/services/auth.service";
import { requirePermission } from "@/services/context";
import { addMessage, assignRequest, setPriority, updateStatus } from "@/services/concierge.service";
import { setMemberEntitlementOverride, setTierEntitlements } from "@/services/entitlement.service";
import { createEvent, updateEvent, upsertZone } from "@/services/event.service";
import { storeUpload } from "@/services/storage.service";
import type { FilePurpose } from "@/generated/prisma/enums";
import type { Actor } from "@/services/context";
import { anonymizeMember, createMember, resendInvitation, setMemberAccountStatus, updateMemberAdmin } from "@/services/member.service";
import { assignMembership, setMembershipStatus, updateTier } from "@/services/membership.service";
import { cancelScheduledNotification, createNotification } from "@/services/notification.service";
import {
  createProgrammeItem,
  deleteProgrammeItem,
  moveProgrammeItem,
  setProgrammeVisibility,
  updateProgrammeItem,
} from "@/services/programme.service";
import { updateSettings } from "@/services/settings.service";
import { changeRole, createStaff, resendStaffInvitation, setStaffStatus, updateStaffContact } from "@/services/staff.service";
import { issueTicket, issueTicketsBulk, reissueCredential, revokeTicket, setTicketSuspended, upsertTicketType } from "@/services/ticket.service";
import {
  assignMembershipSchema,
  bulkIssueSchema,
  eventCreateSchema,
  eventSchema,
  issueTicketSchema,
  notificationSchema,
  programmeItemSchema,
  revokeSchema,
  settingsSchema,
  staffConciergeUpdateSchema,
  staffContactSchema,
  staffSchema,
  ticketTypeSchema,
  tierSchema,
  zoneSchema,
} from "@/validators/admin";
import { staffConciergeMessageSchema } from "@/validators/concierge";
import { adminCreateMemberSchema, adminMemberSchema } from "@/validators/member";

const id = z.string().min(1).max(64);
/**
 * Uploaded image from an ImageUploadField: a new file → its storage key; "remove" → null;
 * otherwise undefined (keep the current image). Call only after the permission check.
 */
async function imageFromForm(form: FormData, field: string, purpose: FilePurpose, actor: Actor): Promise<string | null | undefined> {
  const file = form.get(`${field}File`);
  if (file instanceof File && file.size > 0) return (await storeUpload(file, purpose, actor.userId)).key;
  if (form.get(`${field}Remove`) === "on") return null;
  return undefined;
}

const done = (message: string, extra: { link?: string; redirect?: string; href?: { url: string; label: string } } = {}) => ({ message, ...extra });

// ─── Members ────────────────────────────────────────────────────────────────

export async function createMemberAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(adminCreateMemberSchema, formToObject(form), async (actor, d) => {
    const res = await createMember(actor, d);
    revalidatePath("/admin/members");
    return done(
      res.activation ? (res.activation.delivered ? "Member created and invitation emailed." : "Member created.") : "Member created. No invitation sent yet.",
      {
        link: res.activation && !res.activation.delivered ? res.activation.link : undefined,
        // Stay on the page while there is a hand-off link to copy; otherwise go to the record.
        redirect: res.activation && !res.activation.delivered ? undefined : `/admin/members/${res.memberId}`,
        href: { url: `/admin/members/${res.memberId}`, label: "Open member record" },
      },
    );
  });
}

export async function updateMemberAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  const memberId = String(form.get("memberId") ?? "");
  return authedAction(adminMemberSchema, formToObject(form), async (actor, d) => {
    await updateMemberAdmin(actor, memberId, d);
    revalidatePath(`/admin/members/${memberId}`);
    return done("Member details saved.");
  });
}

export async function assignMembershipAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(assignMembershipSchema, formToObject(form), async (actor, { memberId, ...d }) => {
    await assignMembership(actor, memberId, d);
    revalidatePath(`/admin/members/${memberId}`);
    return done("Membership updated.");
  });
}

export async function setMembershipStatusAction(memberId: string, status: "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED") {
  return authedAction(z.object({ memberId: id, status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"]) }), { memberId, status }, async (actor, d) => {
    await setMembershipStatus(actor, d.memberId, d.status);
    revalidatePath(`/admin/members/${d.memberId}`);
  });
}

export async function setAccountStatusAction(memberId: string, status: "ACTIVE" | "DISABLED") {
  return authedAction(z.object({ memberId: id, status: z.enum(["ACTIVE", "DISABLED"]) }), { memberId, status }, async (actor, d) => {
    await setMemberAccountStatus(actor, d.memberId, d.status);
    revalidatePath(`/admin/members/${d.memberId}`);
  });
}

export async function resendInvitationAction(memberId: string) {
  return authedAction(id, memberId, async (actor, mid) => {
    const r = await resendInvitation(actor, mid);
    return { link: r.delivered ? undefined : r.link };
  });
}

export async function passwordResetLinkAction(memberId: string) {
  return authedAction(id, memberId, async (actor, mid) => {
    requirePermission(actor, "members:manage");
    const member = await db.member.findUniqueOrThrow({ where: { id: mid } });
    const r = await issuePasswordResetLink(actor, member.userId);
    return { link: r.delivered ? undefined : r.link };
  });
}

export async function anonymizeMemberAction(memberId: string) {
  return authedAction(id, memberId, async (actor, mid) => {
    await anonymizeMember(actor, mid);
    revalidatePath("/admin/members");
  });
}

export async function entitlementOverrideAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  const schema = z.object({ memberId: id, code: z.string().min(1), mode: z.enum(["grant", "revoke", "clear"]), value: z.string().optional(), reason: z.string().max(200).optional() });
  return authedAction(schema, formToObject(form), async (actor, d) => {
    const ent = await db.entitlement.findUnique({ where: { code: d.code } });
    if (!ent) throw new AppError("VALIDATION", "Unknown entitlement.");
    const value =
      d.mode === "clear" ? null : d.mode === "revoke" ? (ent.valueType === "BOOLEAN" ? false : ent.valueType === "INTEGER" ? 0 : "none") : ent.valueType === "BOOLEAN" ? true : ent.valueType === "INTEGER" ? Number(d.value ?? 1) : (d.value ?? "");
    await setMemberEntitlementOverride(actor, d.memberId, { code: d.code, value, reason: d.reason });
    revalidatePath(`/admin/members/${d.memberId}`);
    return done("Override saved.");
  });
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

export async function updateTierAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  const obj = formToObject(form);
  return authedAction(tierSchema, obj, async (actor, { tierId, ...d }) => {
    await updateTier(actor, tierId, d);
    const catalogue = await db.entitlement.findMany();
    const values: Record<string, unknown> = {};
    for (const e of catalogue) {
      const raw = obj[`ent_${e.code}`];
      values[e.code] = e.valueType === "BOOLEAN" ? (raw === "on" ? true : null) : raw ? raw : null;
    }
    await setTierEntitlements(actor, tierId, values);
    revalidatePath("/admin/memberships");
    return done("Tier saved.");
  });
}

// ─── Events & programme ─────────────────────────────────────────────────────

const eventInfo = (d: { tagline: string | null; ticketPrefix?: string; supportEmail: string | null; supportPhone: string | null; dressCode: string | null }) => ({
  tagline: d.tagline ?? undefined,
  ticketPrefix: d.ticketPrefix || undefined,
  supportEmail: d.supportEmail ?? undefined,
  supportPhone: d.supportPhone ?? undefined,
  dressCode: d.dressCode ?? undefined,
});

export async function createEventAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(eventCreateSchema, formToObject(form), async (actor, d) => {
    requirePermission(actor, "events:manage");
    const heroImage = await imageFromForm(form, "heroImage", "EVENT_IMAGE", actor);
    const event = await createEvent(actor, {
      name: d.name, slug: d.slug, venue: d.venue, city: d.city, country: d.country, timezone: d.timezone, startDate: d.startDate, endDate: d.endDate,
      description: d.description, heroImage, chapterId: d.chapterId, cloneFromEventId: d.cloneFromEventId, cloneProgramme: d.cloneProgramme,
      info: eventInfo(d),
    });
    revalidatePath("/admin/events");
    return done("Event created as a draft.", { redirect: `/admin/events/${event.id}` });
  });
}

export async function updateEventAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(eventSchema, formToObject(form), async (actor, d) => {
    requirePermission(actor, "events:manage");
    const heroImage = await imageFromForm(form, "heroImage", "EVENT_IMAGE", actor);
    await updateEvent(actor, d.id, {
      name: d.name, venue: d.venue, city: d.city, country: d.country, timezone: d.timezone, startDate: d.startDate, endDate: d.endDate,
      status: d.status, description: d.description, heroImage,
      info: eventInfo(d),
    });
    revalidatePath(`/admin/events/${d.id}`);
    revalidatePath("/", "layout");
    return done("Event saved.");
  });
}

export async function upsertZoneAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(zoneSchema, formToObject(form), async (actor, { eventId, ...d }) => {
    await upsertZone(actor, eventId, d);
    revalidatePath(`/admin/events/${eventId}`);
    return done(d.id ? "Zone saved." : "Zone added.");
  });
}

export async function upsertTicketTypeAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(ticketTypeSchema, formToObject(form), async (actor, d) => {
    const event = await db.event.findUniqueOrThrow({ where: { id: d.eventId } });
    const local = (v: string) => zonedToUtc(v.slice(0, 10), v.slice(11, 16), event.timezone);
    await upsertTicketType(actor, d.eventId, { ...d, validFrom: local(d.validFrom), validUntil: local(d.validUntil) });
    revalidatePath(`/admin/events/${d.eventId}`);
    return done(d.id ? "Ticket type saved." : "Ticket type added.");
  });
}

export async function saveProgrammeItemAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(programmeItemSchema, formToObject(form), async (actor, { id: itemId, eventId, ...d }) => {
    requirePermission(actor, "programme:manage");
    const image = await imageFromForm(form, "image", "PROGRAMME_IMAGE", actor);
    if (itemId) await updateProgrammeItem(actor, itemId, { ...d, image });
    else await createProgrammeItem(actor, eventId, { ...d, image });
    revalidatePath("/admin/programme");
    revalidatePath("/events", "layout");
    return done(itemId ? "Programme item saved." : "Programme item added.", { redirect: `/admin/programme?event=${eventId}` });
  });
}

export async function deleteProgrammeItemAction(itemId: string) {
  return authedAction(id, itemId, async (actor, i) => {
    await deleteProgrammeItem(actor, i);
    revalidatePath("/admin/programme");
  });
}

export async function moveProgrammeItemAction(itemId: string, direction: "up" | "down") {
  return authedAction(z.object({ itemId: id, direction: z.enum(["up", "down"]) }), { itemId, direction }, async (actor, d) => {
    await moveProgrammeItem(actor, d.itemId, d.direction);
    revalidatePath("/admin/programme");
  });
}

export async function setProgrammeVisibilityAction(itemId: string, visibility: "DRAFT" | "MEMBERS" | "RESTRICTED") {
  return authedAction(z.object({ itemId: id, visibility: z.enum(["DRAFT", "MEMBERS", "RESTRICTED"]) }), { itemId, visibility }, async (actor, d) => {
    await setProgrammeVisibility(actor, d.itemId, d.visibility);
    revalidatePath("/admin/programme");
  });
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export async function issueTicketAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(issueTicketSchema, formToObject(form), async (actor, d) => {
    const t = await issueTicket(actor, d);
    revalidatePath(`/admin/members/${d.memberId}`);
    return done(`Issued ${t.ticketNumber}. The member has been notified.`);
  });
}

export async function bulkIssueAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(bulkIssueSchema, formToObject(form), async (actor, d) => {
    const r = await issueTicketsBulk(actor, d);
    revalidatePath("/admin/tickets");
    return done(r.issued === 0 ? "Everyone eligible already holds this ticket." : `Issued ${r.issued} ticket(s).`);
  });
}

export async function revokeTicketAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(revokeSchema, formToObject(form), async (actor, d) => {
    await revokeTicket(actor, d.ticketId, d.reason);
    revalidatePath(`/admin/tickets/${d.ticketId}`);
    return done("Ticket revoked. Its QR code is no longer valid.");
  });
}

export async function suspendTicketAction(ticketId: string, suspended: boolean) {
  return authedAction(z.object({ ticketId: id, suspended: z.boolean() }), { ticketId, suspended }, async (actor, d) => {
    await setTicketSuspended(actor, d.ticketId, d.suspended);
    revalidatePath(`/admin/tickets/${d.ticketId}`);
  });
}

export async function reissueCredentialAction(ticketId: string) {
  return authedAction(id, ticketId, async (actor, t) => {
    await reissueCredential(actor, t);
    revalidatePath(`/admin/tickets/${t}`);
  });
}

// ─── Concierge ──────────────────────────────────────────────────────────────

export async function updateConciergeAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(staffConciergeUpdateSchema, formToObject(form), async (actor, d) => {
    const before = await db.conciergeRequest.findUniqueOrThrow({ where: { id: d.requestId } });
    if (d.assignedToId !== undefined && (d.assignedToId || null) !== before.assignedToId) await assignRequest(actor, d.requestId, d.assignedToId || null);
    if (d.priority && d.priority !== before.priority) await setPriority(actor, d.requestId, d.priority);
    if (d.status && d.status !== before.status) await updateStatus(actor, d.requestId, d.status);
    revalidatePath(`/admin/concierge/${d.requestId}`);
    return done("Request updated.");
  });
}

export async function staffConciergeMessageAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  const attachment = form.get("attachment");
  return authedAction(staffConciergeMessageSchema, formToObject(form), async (actor, d) => {
    requirePermission(actor, "concierge:manage");
    await addMessage(actor, d.requestId, { message: d.message, internalNote: d.internalNote }, attachment instanceof File ? attachment : null);
    revalidatePath(`/admin/concierge/${d.requestId}`);
    return done(d.internalNote ? "Internal note added." : "Message sent to member.");
  });
}

// ─── Notifications ──────────────────────────────────────────────────────────

export async function sendNotificationAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(notificationSchema, formToObject(form), async (actor, d) => {
    let scheduledAt: Date | null = null;
    if (d.scheduledAt) {
      // datetime-local is interpreted in the featured event's timezone (Asia/Dubai for V1).
      const ev = await db.event.findFirst({ where: { status: { in: ["PUBLISHED", "LIVE"] } }, orderBy: { startDate: "asc" } });
      scheduledAt = zonedToUtc(d.scheduledAt.slice(0, 10), d.scheduledAt.slice(11, 16), ev?.timezone ?? "Asia/Dubai");
    }
    const n = await createNotification(actor, {
      title: d.title, body: d.body, type: d.type, targetType: d.targetType, targetId: d.targetId ?? null,
      url: d.url || null, channels: d.channels, scheduledAt,
    });
    revalidatePath("/admin/notifications");
    return done(n.status === "SCHEDULED" ? "Notification scheduled." : "Notification sent.");
  });
}

export async function cancelNotificationAction(notificationId: string) {
  return authedAction(id, notificationId, async (actor, n) => {
    await cancelScheduledNotification(actor, n);
    revalidatePath("/admin/notifications");
  });
}

// ─── Staff & settings ───────────────────────────────────────────────────────

export async function createStaffAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(staffSchema, formToObject(form), async (actor, d) => {
    const r = await createStaff(actor, d);
    revalidatePath("/admin/staff");
    return done("Staff account created.", { link: r.activation.delivered ? undefined : r.activation.link });
  });
}

export async function updateStaffContactAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(staffContactSchema, formToObject(form), async (actor, { userId, ...d }) => {
    await updateStaffContact(actor, userId, d);
    revalidatePath("/admin/staff");
    return done("Staff details saved.");
  });
}

export async function changeRoleAction(userId: string, role: string) {
  return authedAction(z.object({ userId: id, role: z.enum(["CONCIERGE", "CHECK_IN_STAFF", "ADMIN", "SUPER_ADMIN"]) }), { userId, role }, async (actor, d) => {
    await changeRole(actor, d.userId, d.role);
    revalidatePath("/admin/staff");
  });
}

export async function setStaffStatusAction(userId: string, status: "ACTIVE" | "DISABLED") {
  return authedAction(z.object({ userId: id, status: z.enum(["ACTIVE", "DISABLED"]) }), { userId, status }, async (actor, d) => {
    await setStaffStatus(actor, d.userId, d.status);
    revalidatePath("/admin/staff");
  });
}

export async function resendStaffInvitationAction(userId: string) {
  return authedAction(id, userId, async (actor, u) => {
    const r = await resendStaffInvitation(actor, u);
    return { link: r.delivered ? undefined : r.link };
  });
}

export async function updateSettingsAction(_p: AdminFormState, form: FormData): Promise<AdminFormState> {
  return authedAction(settingsSchema, formToObject(form), async (actor, d) => {
    await updateSettings(actor, d);
    revalidatePath("/admin/settings");
    return done("Settings saved.");
  });
}
