import Link from "next/link";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { JoiaLogo } from "@/components/joia/joia-logo";
import { PermissionBadge } from "@/components/joia/badges";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/dal";
import { logoutAction } from "@/app/(auth)/actions";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <JoiaLogo width={96} />
            <span className="text-[10px] uppercase tracking-[0.24em] text-pearl-dim">Check-in</span>
          </div>
          <Suspense fallback={null}>
            <StaffIdentity />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 pb-10 pt-4">{children}</main>
    </div>
  );
}

async function StaffIdentity() {
  await requirePermissionPage("scan:validate");
  const user = (await getSessionUser())!;
  return (
    <div className="flex items-center gap-3">
      {can(user.role, "admin:access") && (
        <Link href="/admin" className="text-[10px] uppercase tracking-[0.2em] text-pearl-muted hover:text-pearl">
          Admin
        </Link>
      )}
      <PermissionBadge role={user.role} className="hidden text-pearl-muted sm:inline-flex" />
      <form action={logoutAction}>
        <button className="grid size-9 place-items-center rounded-full text-pearl-muted hover:text-pearl" aria-label={`Sign out ${user.name}`}>
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
