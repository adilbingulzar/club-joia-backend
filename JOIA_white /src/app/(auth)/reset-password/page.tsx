import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { peekAuthToken } from "@/services/auth.service";
import { PASSWORD_MIN } from "@/validators/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  return (
    <div className="animate-fade-up">
      <p className="eyebrow text-center">Account</p>
      <h1 className="display mt-3 text-center text-5xl">New password</h1>
      <Suspense fallback={<div className="skeleton mt-10 h-56" aria-hidden />}>
        <ResetBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ResetBody({ searchParams }: Pick<PageProps<"/reset-password">, "searchParams">) {
  const { token } = await searchParams;
  const valid = typeof token === "string" ? await peekAuthToken(token, "PASSWORD_RESET") : null;
  if (!valid || typeof token !== "string") {
    return (
      <div className="mt-8 space-y-6 text-center">
        <p className="text-sm text-pearl-muted">This reset link is invalid or has expired.</p>
        <Link href="/forgot-password" className="text-[11px] uppercase tracking-[0.2em] text-ruby">
          Request a new link
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-10">
      <p className="mb-6 text-center text-sm text-pearl-muted">
        For {valid.email}. Use at least {PASSWORD_MIN} characters — a short phrase works well.
      </p>
      <SetPasswordForm token={token} mode="reset" />
    </div>
  );
}
