import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { JoiaLogo } from "@/components/joia/joia-logo";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { getActor, getMfaPendingUser } from "@/lib/auth/dal";
import { homePathFor } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

/**
 * Staff portal sign-in (admins, concierge, check-in staff). Same accounts system as members,
 * but member accounts are refused here, and signed-in staff land on their role's home
 * (/admin, /admin/concierge or /staff/scanner).
 */
export default function StaffLoginPage({ searchParams }: PageProps<"/admin/login">) {
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
        <h1 className="display text-center text-4xl">Operations sign in</h1>
        <p className="mt-2 text-center text-sm text-pearl-dim">Admin, concierge and check-in staff.</p>
        <div className="mt-10">
          <Suspense fallback={<div className="skeleton h-64" aria-hidden />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
      <footer className="safe-bottom relative z-10 px-6 pb-6 text-center text-xs text-pearl-dim">
        Member? <Link href="/login" className="underline underline-offset-4 hover:text-pearl">Sign in to the member app</Link>
      </footer>
    </div>
  );
}

async function Form({ searchParams }: Pick<PageProps<"/admin/login">, "searchParams">) {
  const [sp, actor] = await Promise.all([searchParams, getActor()]);
  // Already signed in as staff → straight to the portal.
  if (actor && actor.role !== "MEMBER") redirect(homePathFor(actor.role));
  // Password already confirmed, the authenticator code not yet.
  if (!actor && (await getMfaPendingUser())) redirect("/admin/mfa");
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return <LoginForm portal="staff" next={next} resetDone={sp.reset === "1"} />;
}
