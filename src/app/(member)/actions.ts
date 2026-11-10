"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authedAction, formToObject } from "@/lib/actions";
import { clearSessionCookie } from "@/lib/auth/session";
import { AppError, type ActionResult } from "@/lib/errors";
import { changePassword, signOutEverywhere } from "@/services/auth.service";
import { addMessage, cancelMyRequest, createRequest } from "@/services/concierge.service";
import { removeMyPhoto, requestAccountDeletion, setMyPhoto, updateMyProfile } from "@/services/member.service";
import { markNotificationsRead, removePushSubscription, savePushSubscription } from "@/services/notification.service";
import { toggleFavorite } from "@/services/programme.service";
import { conciergeMessageSchema, newConciergeSchema } from "@/validators/concierge";
import { changePasswordSchema } from "@/validators/auth";
import { emergencySchema, hospitalitySchema, memberSelfProfileSchema, notificationPrefsSchema, privacySchema } from "@/validators/member";

const id = z.string().min(1).max(64);

export async function toggleFavoriteAction(programItemId: string) {
  return authedAction(id, programItemId, async (actor, itemId) => {
    const res = await toggleFavorite(actor, itemId);
    revalidatePath("/events", "layout");
    return res;
  });
}

export async function markNotificationsReadAction(recipientId?: string) {
  return authedAction(id.optional(), recipientId, async (actor, rid) => {
    await markNotificationsRead(actor, rid);
    revalidatePath("/notifications");
  });
}

// ─── Profile ────────────────────────────────────────────────────────────────

export type FormState = ActionResult<string | undefined> | undefined;

export async function updatePersonalAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(memberSelfProfileSchema, formToObject(form), async (actor, data) => {
    await updateMyProfile(actor, data);
    revalidatePath("/profile");
    return "Personal details saved.";
  });
}

export async function updateHospitalityAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(hospitalitySchema, formToObject(form), async (actor, d) => {
    const { seatingPreference, drinksPreference, arrivalNotes, ...fields } = d;
    await updateMyProfile(actor, fields, { preferences: { hospitality: { seatingPreference, drinksPreference, arrivalNotes } } });
    revalidatePath("/profile");
    return "Hospitality preferences saved.";
  });
}

export async function updateEmergencyAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(emergencySchema, formToObject(form), async (actor, data) => {
    await updateMyProfile(actor, data);
    revalidatePath("/profile");
    return "Emergency contact saved.";
  });
}

export async function updateNotificationPrefsAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(notificationPrefsSchema, formToObject(form), async (actor, data) => {
    await updateMyProfile(actor, {}, { preferences: { notifications: data } });
    revalidatePath("/profile");
    return "Notification preferences saved.";
  });
}

export async function updatePrivacyAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(privacySchema, formToObject(form), async (actor, data) => {
    await updateMyProfile(actor, {}, { privacy: data });
    revalidatePath("/profile");
    return "Privacy settings saved.";
  });
}

export async function uploadPhotoAction(_prev: FormState, form: FormData): Promise<FormState> {
  const file = form.get("photo");
  return authedAction(z.instanceof(File, { message: "Choose a photo." }), file, async (actor, f) => {
    if (f.size === 0) throw new AppError("VALIDATION", "Choose a photo.");
    await setMyPhoto(actor, f);
    revalidatePath("/", "layout");
    return "Profile photo updated.";
  });
}

export async function removePhotoAction() {
  return authedAction(z.undefined(), undefined, async (actor) => {
    await removeMyPhoto(actor);
    revalidatePath("/", "layout");
  });
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(changePasswordSchema, formToObject(form), async (actor, d) => {
    await changePassword(actor, d.current, d.password);
    return "Password changed. Other devices have been signed out.";
  });
}

export async function signOutEverywhereAction() {
  const res = await authedAction(z.undefined(), undefined, async (actor) => signOutEverywhere(actor));
  if (res.ok) {
    await clearSessionCookie();
    redirect("/login");
  }
  return res;
}

export async function requestDeletionAction(_prev: FormState, form: FormData): Promise<FormState> {
  return authedAction(z.object({ confirm: z.literal("DELETE", { message: "Type DELETE to confirm." }) }), formToObject(form), async (actor) => {
    await requestAccountDeletion(actor);
    revalidatePath("/profile");
    return "Your deletion request has been received. CLUB JOIA will confirm within 30 days.";
  });
}

const pushSubSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});

export async function savePushSubscriptionAction(sub: unknown) {
  return authedAction(pushSubSchema, sub, async (actor, s) => {
    await savePushSubscription(actor, s);
  });
}

export async function removePushSubscriptionAction(endpoint: string) {
  return authedAction(z.string().max(1000), endpoint, async (actor, e) => {
    await removePushSubscription(actor, e);
  });
}

// ─── Concierge ──────────────────────────────────────────────────────────────

export type ConciergeFormState = ActionResult<{ id: string }> | undefined;

export async function createConciergeAction(_prev: ConciergeFormState, form: FormData): Promise<ConciergeFormState> {
  const attachment = form.get("attachment");
  const res = await authedAction(newConciergeSchema, formToObject(form), async (actor, data) => {
    const req = await createRequest(actor, data, attachment instanceof File ? attachment : null);
    revalidatePath("/concierge");
    return { id: req.id };
  });
  if (res.ok) redirect(`/concierge/${res.data.id}?created=1`);
  return res;
}

export async function sendConciergeMessageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const attachment = form.get("attachment");
  return authedAction(conciergeMessageSchema, formToObject(form), async (actor, d) => {
    await addMessage(actor, d.requestId, { message: d.message }, attachment instanceof File ? attachment : null);
    revalidatePath(`/concierge/${d.requestId}`);
    return undefined;
  });
}

export async function cancelConciergeAction(requestId: string) {
  return authedAction(id, requestId, async (actor, rid) => {
    await cancelMyRequest(actor, rid);
    revalidatePath(`/concierge/${rid}`);
    revalidatePath("/concierge");
  });
}

