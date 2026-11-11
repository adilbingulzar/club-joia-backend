"use server";

import { redirect } from "next/navigation";
import { getMfaPendingUser } from "@/lib/auth/dal";
import { homePathFor } from "@/lib/auth/permissions";
import { requestMeta } from "@/lib/auth/session";
import { AppError, toActionError } from "@/lib/errors";
import { verifyMfaCode } from "@/services/mfa.service";
import { safeNextPath } from "@/validators/auth";
import type { AuthFormState } from "@/app/(auth)/actions";

export async function verifyMfaAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  let destination: string;
  try {
    const user = await getMfaPendingUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Your sign-in has ended. Please sign in again.");
    const code = String(form.get("code") ?? "").slice(0, 20);
    await verifyMfaCode(user, code, await requestMeta());
    const next = safeNextPath(String(form.get("next") ?? ""));
    destination = next && (next.startsWith("/admin") || next.startsWith("/staff")) ? next : homePathFor(user.role);
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(destination);
}
