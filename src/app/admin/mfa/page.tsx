import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { JoiaLogo } from "@/components/joia/joia-logo";
import { FormMessage } from "@/components/ui/form";
import { logoutAction } from "@/app/(auth)/actions";
import { getActor, getMfaPendingUser } from "@/lib/auth/dal";
import { homePathFor } from "@/lib/auth/permissions";
import { toActionError } from "@/lib/errors";
import { startMfaEnrolment } from "@/services/mfa.service";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-factor sign-in", robots: { index: false, follow: false } };

/**
 * Second sign-in step for ADMIN and SUPER_ADMIN (services/mfa.service.ts): set up an
 * authenticator app the first time, then enter its current code at every sign-in.
 */
export default function MfaPage({ searchParams }: PageProps<"/admin/mfa">) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-ink">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[480px] w-[760px] -translate-x-1/2 rounded-full bg-pearl/[0.06] blur-[120px]" />
      </div>
      <header className="safe-top relative z-10 flex flex-col items-center gap-3 px-6 pt-14">
        <JoiaLogo width={160} priority />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-pearl-muted">
          <ShieldCheck className="size-3.5" aria-hidden /> Staff portal
        </span>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <Suspense fallback={<div className="skeleton h-96" aria-hidden />}>
          <Step searchParams={searchParams} />
        </Suspense>
      </main>
      <footer className="safe-bottom relative z-10 px-6 pb-6 text-center text-xs text-pearl-dim">
        <form action={logoutAction}>
          <button className="underline underline-offset-4 hover:text-pearl">Sign out</button>
        </form>
      </footer>
    </div>
  );
}

async function Step({ searchParams }: Pick<PageProps<"/admin/mfa">, "searchParams">) {
  const [sp, user] = await Promise.all([searchParams, getMfaPendingUser()]);
  if (!user) {
    const actor = await getActor();
    redirect(actor ? homePathFor(actor.role) : "/admin/login");
  }
  const next = typeof sp.next === "string" ? sp.next : undefined;

  if (user.mfaEnabled) {
    return (
      <>
        <h1 className="display text-center text-4xl">Two-factor sign-in</h1>
        <p className="mt-2 text-center text-sm text-pearl-dim">Enter the 6-digit code from your authenticator app for {user.email}.</p>
        <div className="mt-10">
          <MfaForm next={next} enrolling={false} />
        </div>
        <p className="mt-6 text-center text-xs text-pearl-dim">Lost your phone? Ask a super admin to reset two-factor sign-in for your account.</p>
      </>
    );
  }

  let enrolment: Awaited<ReturnType<typeof startMfaEnrolment>>;
  try {
    enrolment = await startMfaEnrolment(user);
  } catch (e) {
    return <FormMessage error={toActionError(e)} />;
  }
  return (
    <>
      <h1 className="display text-center text-4xl">Set up two-factor sign-in</h1>
      <p className="mt-2 text-center text-sm text-pearl-dim">
        Admin accounts need a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) at every sign-in.
      </p>
      <ol className="mt-8 space-y-6 text-sm text-pearl-muted">
        <li>
          <p>1. In the app, add an account and scan this code:</p>
          <div
            className="mx-auto mt-4 w-52 overflow-hidden rounded-xl bg-white p-2"
            role="img"
            aria-label="QR code for your authenticator app"
            dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }}
          />
          <p className="mt-4 text-xs text-pearl-dim">Can&rsquo;t scan it? Enter this key instead:</p>
          <p className="mt-1 select-all break-all font-mono text-sm tracking-wider text-pearl">{enrolment.secret.match(/.{1,4}/g)?.join(" ")}</p>
        </li>
        <li>
          <p>2. Enter the 6-digit code the app shows:</p>
          <div className="mt-4">
            <MfaForm next={next} enrolling />
          </div>
        </li>
      </ol>
    </>
  );
}
