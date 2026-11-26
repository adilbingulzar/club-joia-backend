import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { homePathFor } from "@/lib/auth/permissions";
import { env } from "@/lib/config/env";
import { BottomNav, BottomNavFrame } from "@/components/member/bottom-nav";
import { MemberHeaderActions, MemberHeaderShell } from "@/components/member/member-header";
import { OfflineBanner } from "@/components/pwa/offline-banner";

/**
 * Closed: members use the website now (club-joia-300-next /login and /account, through
 * /api/member-app), since this app is behind the IP allowlist. The pages stay here, unused:
 * staff go to their own home, members to the website, anyone else to the staff sign-in.
 */
async function closeMemberPages(): Promise<never> {
  const user = await getSessionUser();
  if (user && user.role !== "MEMBER") redirect(homePathFor(user.role));
  const site = env().MEMBER_APP_URL;
  redirect(user && site ? new URL("/account", site).toString() : "/admin/login");
}

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  await closeMemberPages();
  return (
    <div className="min-h-dvh bg-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-pearl focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <MemberHeaderShell>
        <Suspense fallback={<div className="skeleton size-9 rounded-full" aria-hidden />}>
          <MemberHeaderActions />
        </Suspense>
      </MemberHeaderShell>
      <OfflineBanner />
      <main id="main" className="mx-auto w-full max-w-lg px-5 pb-32 pt-6">
        {children}
      </main>
      <Suspense fallback={<BottomNavFrame pathname={null} />}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
