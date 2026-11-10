import { Suspense } from "react";
import { BottomNav, BottomNavFrame } from "@/components/member/bottom-nav";
import { MemberHeaderActions, MemberHeaderShell } from "@/components/member/member-header";
import { OfflineBanner } from "@/components/pwa/offline-banner";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
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
