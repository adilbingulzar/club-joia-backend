import type { Metadata } from "next";
import { Suspense } from "react";
import { peekAuthToken } from "@/services/auth.service";
import { getSettings } from "@/services/settings.service";
import { PASSWORD_MIN } from "@/validators/auth";
import { SetPasswordForm } from "../reset-password/set-password-form";

export const metadata: Metadata = { title: "Activate your membership" };

export default function ActivatePage({ searchParams }: PageProps<"/activate">) {
  return (
    <div className="animate-fade-up">
      <p className="eyebrow text-center">Your invitation</p>
      <h1 className="display mt-3 text-center text-5xl">Welcome to the club</h1>
      <Suspense fallback={<div className="skeleton mt-10 h-72" aria-hidden />}>
        <ActivateBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ActivateBody({ searchParams }: Pick<PageProps<"/activate">, "searchParams">) {
  const { token } = await searchParams;
  const invite = typeof token === "string" ? await peekAuthToken(token, "ACTIVATION") : null;
  if (!invite || typeof token !== "string") {
    return (
      <p className="mt-8 text-center text-sm text-pearl-muted">
        This invitation link is invalid, has already been used, or has expired. Please contact CLUB JOIA concierge for a new invitation.
      </p>
    );
  }
  const settings = await getSettings();
  return (
    <div className="mt-8">
      <p className="mb-8 text-center text-sm text-pearl-muted">
        {invite.name}, set a password for <span className="text-pearl">{invite.email}</span> to activate your private account. Use at least {PASSWORD_MIN} characters.
      </p>
      <SetPasswordForm token={token} mode="activate" termsUrl={settings["legal.termsUrl"]} privacyUrl={settings["legal.privacyUrl"]} />
    </div>
  );
}
