import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { validationError } from "@/lib/actions";
import { AppError, notFound } from "@/lib/errors";
import { zonedToUtc } from "@/lib/time";
import { changePassword, signOutEverywhere } from "./auth.service";
import { addMessage, cancelMyRequest, createRequest, getRequest, listMyRequests } from "./concierge.service";
import type { Actor } from "./context";
import { getFeaturedEvent, getMemberEventBySlug, listMemberEvents } from "./event.service";
import { exportMyData, getMyProfile, removeMyPhoto, requestAccountDeletion, setMyPhoto, updateMyProfile } from "./member.service";
import { getMyMembership } from "./membership.service";
import { listMyNotifications, markNotificationsRead, unreadCount } from "./notification.service";
import { getMemberProgramme, getPublicProgramme, summariseProgramme, toggleFavorite } from "./programme.service";
import { issueQrForMyTicket } from "./qr.service";
import { getSettings } from "./settings.service";
import { readStoredObject } from "./storage.service";
import { getMyTicket, listMyTickets } from "./ticket.service";
import { changePasswordSchema } from "@/validators/auth";
import { conciergeMessageSchema, newConciergeSchema } from "@/validators/concierge";
import { emergencySchema, hospitalitySchema, memberSelfProfileSchema, notificationPrefsSchema, privacySchema } from "@/validators/member";

/**
 * The signed-in member's pages on the website (club-joia-300-next app/(member)/account), through
 * /api/member-app/<action>: each read gives one page's data, the same services the member app's
 * pages here use (src/app/(member), closed); each write is one of its forms (src/app/(member)/actions.ts).
 * Writes take the form's fields as the browser sent them (strings; a ticked checkbox is "on").
 * No push notifications on the website: members see updates in its Notifications list.
 */
export type MemberInput = { fields: Record<string, unknown>; file: File | null };
type Handler = (actor: Actor & { memberId: string }, input: MemberInput) => Promise<unknown>;

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

// a form's fields as formToObject (src/lib/actions.ts) gives them: empty strings are left out
function formFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (typeof v === "string" && v !== "") out[k] = v;
  return out;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

const id = z.string().min(1).max(64);

/** Programme, settings and the like the website needs on most pages. */
async function settingsForMember() {
  const s = await getSettings();
  return { "support.email": s["support.email"], "legal.termsUrl": s["legal.termsUrl"], "legal.privacyUrl": s["legal.privacyUrl"] };
}

const HANDLERS: Record<string, Handler> = {
  // ── pages ──
  header: async (actor) => {
    const [count, member] = await Promise.all([
      unreadCount(actor),
      db.member.findUnique({ where: { id: actor.memberId }, select: { firstName: true, lastName: true, profilePhotoKey: true } }),
    ]);
    return { unread: count, firstName: member?.firstName ?? null, lastName: member?.lastName ?? null, profilePhotoKey: member?.profilePhotoKey ?? null };
  },
  home: async (actor) => {
    const [membership, event, tickets, settings, latestRequest] = await Promise.all([
      getMyMembership(actor),
      getFeaturedEvent(),
      listMyTickets(actor),
      settingsForMember(),
      db.conciergeRequest.findFirst({ where: { memberId: actor.memberId }, orderBy: { updatedAt: "desc" }, select: { id: true, subject: true, status: true } }),
    ]);
    const programme = event ? await getMemberProgramme(actor, event.id) : null;
    const summary = programme ? summariseProgramme(programme) : null;
    const firstStart = programme?.days.flatMap((d) => d.items)[0]?.startsAt;
    const countdownTarget = firstStart ?? (event ? zonedToUtc(event.start, "00:00", event.timezone).toISOString() : null);
    return { membership, event, tickets, settings, latestRequest, programme, summary, countdownTarget };
  },
  card: async (actor) => {
    const [membership, settings, tickets] = await Promise.all([getMyMembership(actor), settingsForMember(), listMyTickets(actor)]);
    return { membership, settings, tickets };
  },
  tickets: async (actor) => ({ tickets: await listMyTickets(actor) }),
  ticket: async (actor, { fields }) => {
    const ticket = await getMyTicket(actor, str(fields.ticketNumber, 100));
    return { ticket, membership: await getMyMembership(actor) };
  },
  qr: async (actor, { fields }) => issueQrForMyTicket(actor, str(fields.ticketNumber, 100)),
  events: async () => ({ events: await listMemberEvents() }),
  event: async (actor, { fields }) => {
    const event = await getMemberEventBySlug(str(fields.slug, 200));
    if (!event) throw notFound("Event");
    const [programme, tickets] = await Promise.all([getMemberProgramme(actor, event.id), listMyTickets(actor)]);
    return { event, programme, tickets: tickets.filter((t) => t.eventId === event.id) };
  },
  notifications: async (actor) => ({ items: await listMyNotifications(actor) }),
  "concierge-list": async (actor) => ({ requests: await listMyRequests(actor) }),
  "concierge-new": async () => {
    const event = await getFeaturedEvent();
    return { eventId: event?.id ?? null, eventStart: event?.start ?? null };
  },
  "concierge-get": async (actor, { fields }) => ({ request: await getRequest(actor, str(fields.id, 64)) }),
  profile: async (actor) => {
    const [profile, membership] = await Promise.all([getMyProfile(actor), getMyMembership(actor)]);
    return { profile, membership };
  },
  export: async (actor) => exportMyData(actor),
  // the event's programme without personal or restricted items, kept by the website's service worker for offline reading
  "public-programme": async (_actor, { fields }) => {
    const data = await getPublicProgramme(str(fields.slug, 200));
    if (!data) throw notFound("Event");
    return data;
  },

  // ── forms ──
  favorite: async (actor, { fields }) => toggleFavorite(actor, parse(id, fields.itemId)),
  "notifications-read": async (actor, { fields }) => {
    await markNotificationsRead(actor, fields.recipientId === undefined ? undefined : parse(id, fields.recipientId));
    return null;
  },
  "profile-personal": async (actor, { fields }) => {
    await updateMyProfile(actor, parse(memberSelfProfileSchema, formFields(fields)));
    return "Personal details saved.";
  },
  "profile-hospitality": async (actor, { fields }) => {
    const { seatingPreference, drinksPreference, arrivalNotes, ...rest } = parse(hospitalitySchema, formFields(fields));
    await updateMyProfile(actor, rest, { preferences: { hospitality: { seatingPreference, drinksPreference, arrivalNotes } } });
    return "Hospitality preferences saved.";
  },
  "profile-emergency": async (actor, { fields }) => {
    await updateMyProfile(actor, parse(emergencySchema, formFields(fields)));
    return "Emergency contact saved.";
  },
  "profile-notifications": async (actor, { fields }) => {
    await updateMyProfile(actor, {}, { preferences: { notifications: parse(notificationPrefsSchema, formFields(fields)) } });
    return "Notification preferences saved.";
  },
  "profile-privacy": async (actor, { fields }) => {
    await updateMyProfile(actor, {}, { privacy: parse(privacySchema, formFields(fields)) });
    return "Privacy settings saved.";
  },
  "change-password": async (actor, { fields }) => {
    // empty boxes get their own messages ("Enter your current password.") rather than "Invalid input"
    const d = parse(changePasswordSchema, { current: "", password: "", confirm: "", ...formFields(fields) });
    await changePassword(actor, d.current, d.password);
    return "Password changed. Other devices have been signed out.";
  },
  "sign-out-everywhere": async (actor) => signOutEverywhere(actor),
  // the profile photo comes as the form's file (multipart "attachment")
  "photo-upload": async (actor, { file }) => {
    if (!file) throw new AppError("VALIDATION", "Choose a photo.");
    await setMyPhoto(actor, file);
    return "Profile photo updated.";
  },
  "photo-remove": async (actor) => {
    await removeMyPhoto(actor);
    return null;
  },
  "request-deletion": async (actor, { fields }) => {
    parse(z.object({ confirm: z.literal("DELETE", { message: "Type DELETE to confirm." }) }), { confirm: "", ...formFields(fields) });
    await requestAccountDeletion(actor);
    return "Your deletion request has been received. CLUB JOIA will confirm within 30 days.";
  },
  "concierge-create": async (actor, { fields, file }) => {
    // an empty subject or request gets its own message ("Add a short subject.") rather than "Invalid input"
    const req = await createRequest(actor, parse(newConciergeSchema, { subject: "", description: "", ...formFields(fields) }), file);
    return { id: req.id };
  },
  "concierge-message": async (actor, { fields, file }) => {
    const d = parse(conciergeMessageSchema, { message: "", ...formFields(fields) });
    await addMessage(actor, d.requestId, { message: d.message }, file);
    return null;
  },
  "concierge-cancel": async (actor, { fields }) => {
    await cancelMyRequest(actor, parse(id, fields.requestId));
    return null;
  },
};

export function isMemberAppAction(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(HANDLERS, action);
}

export function runMemberAppAction(action: string, actor: Actor & { memberId: string }, input: MemberInput): Promise<unknown> {
  return HANDLERS[action](actor, input);
}

/**
 * A stored file for the signed-in member (src/app/api/files, the member's part): their own uploads,
 * attachments on their concierge requests, and event and programme images.
 */
export async function memberFile(actor: Actor & { memberId: string }, key: string) {
  const object = await readStoredObject(key);
  if (!object) throw notFound("File");
  const { meta, body } = object;
  let allowed = meta.ownerUserId === actor.userId;
  if (!allowed) {
    if (meta.purpose === "PROFILE_PHOTO") allowed = false;
    else if (meta.purpose === "CONCIERGE_ATTACHMENT") {
      const msg = await db.conciergeRequestMessage.findFirst({ where: { attachmentKey: key }, select: { request: { select: { memberId: true } } } });
      allowed = msg?.request.memberId === actor.memberId;
    } else allowed = true;
  }
  if (!allowed) throw new AppError("NOT_FOUND", "File not found.");
  return { contentType: meta.contentType, body };
}
