"use server";

import { redirect } from "next/navigation";
import { homePathFor, mfaRequired } from "@/lib/auth/permissions";
import { clearSessionCookie, readSessionToken, requestMeta, writeSessionCookie } from "@/lib/auth/session";
import { validationError } from "@/lib/actions";
import { AppError, toActionError, type ActionError } from "@/lib/errors";
import {
  activateAccount,
  authenticate,
  requestPasswordReset,
  resetPassword,
  revokeSessionByToken,
} from "@/services/auth.service";
import { activateSchema, loginSchema, requestResetSchema, safeNextPath, setPasswordSchema } from "@/validators/auth";

export type AuthFormState = { error?: ActionError; success?: string; values?: Record<string, string> } | undefined;

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

export async function loginAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  let destination: string;
  try {
    const parsed = loginSchema.safeParse({ email: str(form, "email"), password: str(form, "password"), next: str(form, "next") || undefined });
    if (!parsed.success) throw validationError(parsed.error);
    const result = await authenticate(parsed.data.email, parsed.data.password, await requestMeta());
    // The staff portal sign-in (/admin/login) is for staff accounts only.
    if (str(form, "portal") === "staff" && result.role === "MEMBER") {
      await revokeSessionByToken(result.token);
      throw new AppError("FORBIDDEN", "This sign-in is for CLUB JOIA staff. Members sign in at the member app.");
    }
    await writeSessionCookie(result.token, result.expiresAt);
    const next = safeNextPath(parsed.data.next);
    // Members can't be bounced into staff areas (and vice versa) by a crafted ?next=.
    const nextAllowed = next && (result.role === "MEMBER" ? !next.startsWith("/admin") && !next.startsWith("/staff") : next.startsWith("/admin") || next.startsWith("/staff"));
    destination = nextAllowed ? next! : homePathFor(result.role);
    // Admins confirm an authenticator code before anything else (/admin/mfa), then go on.
    if (mfaRequired(result.role)) destination = "/admin/mfa" + (nextAllowed ? `?next=${encodeURIComponent(next!)}` : "");
  } catch (e) {
    return { error: toActionError(e), values: { email: str(form, "email") } };
  }
  redirect(destination);
}

export async function logoutAction() {
  const token = await readSessionToken();
  const role = token ? await revokeSessionByToken(token) : null;
  await clearSessionCookie();
  redirect(role && role !== "MEMBER" ? "/admin/login" : "/login");
}

export async function requestResetAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  try {
    const parsed = requestResetSchema.safeParse({ email: str(form, "email") });
    if (!parsed.success) throw validationError(parsed.error);
    await requestPasswordReset(parsed.data.email, await requestMeta());
    return { success: "If an account exists for that email, a reset link is on its way. It expires in 60 minutes." };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function resetPasswordAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  try {
    const parsed = setPasswordSchema.safeParse({ token: str(form, "token"), password: str(form, "password"), confirm: str(form, "confirm") });
    if (!parsed.success) throw validationError(parsed.error);
    await resetPassword(parsed.data.token, parsed.data.password, await requestMeta());
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect("/login?reset=1");
}

export async function activateAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  let destination: string;
  try {
    const parsed = activateSchema.safeParse({
      token: str(form, "token"),
      password: str(form, "password"),
      confirm: str(form, "confirm"),
      acceptTerms: str(form, "acceptTerms"),
    });
    if (!parsed.success) throw validationError(parsed.error);
    const result = await activateAccount(parsed.data.token, parsed.data.password, await requestMeta());
    await writeSessionCookie(result.token, result.expiresAt);
    destination = result.role === "MEMBER" ? "/?welcome=1" : mfaRequired(result.role) ? "/admin/mfa" : homePathFor(result.role);
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(destination);
}
