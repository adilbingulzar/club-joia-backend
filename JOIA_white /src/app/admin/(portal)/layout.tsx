import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { JoiaLogo } from "@/components/joia/joia-logo";
import { PermissionBadge } from "@/components/joia/badges";
import { AdminNav, AdminNavFrame } from "@/components/admin/admin-nav";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can, PERMISSIONS, mfaRecommended } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/dal";
import { logoutAction } from "@/app/(auth)/actions";

/** Desktop-first admin shell: black sidebar, pearl working canvas. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin min-h-dvh bg-paper text-ink lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="bg-ink text-pearl lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 lg:block">
          <JoiaLogo variant="white" width={120} />
          <p className="text-[10px] uppercase tracking-[0.3em] text-pearl-dim lg:mt-3">Operations</p>
        </div>
        <div className="pb-3 lg:pb-6">
          <Suspense fallback={<AdminNavFrame allowed={[]} showScanner={false} pathname={null} />}>
            <NavWithPermissions />
          </Suspense>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-black/8 bg-white/70 px-6 backdrop-blur">
          <Suspense fallback={<div className="skeleton h-6 w-40" aria-hidden />}>
            <AdminIdentity />
          </Suspense>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

async function NavWithPermissions() {
  const actor = await requirePermissionPage("admin:access");
  const allowed = PERMISSIONS.filter((p) => can(actor.role, p));
  return <AdminNav allowed={[...allowed]} showScanner={can(actor.role, "scan:validate")} />;
}

async function AdminIdentity() {
  const user = await getSessionUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      {mfaRecommended(user.role) && (
        <span className="hidden text-[11px] text-black/45 xl:inline" title="Multi-factor authentication is planned for admin accounts">
          MFA: planned
        </span>
      )}
      <span className="text-black/70">{user.name}</span>
      <PermissionBadge role={user.role} />
      <form action={logoutAction}>
        <button className="grid size-8 place-items-center rounded-full text-black/50 hover:bg-black/5 hover:text-ink" aria-label="Sign out">
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
