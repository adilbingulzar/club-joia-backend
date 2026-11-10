"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, Bell, CalendarRange, ClipboardList, ConciergeBell, Crown, LayoutDashboard, ListOrdered, ScanLine, Settings, Ticket, UserCog, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/auth/permissions";

export const ADMIN_NAV: { href: string; label: string; icon: typeof Users; permission: Permission }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: "/admin/members", label: "Members", icon: Users, permission: "members:view" },
  { href: "/admin/memberships", label: "Memberships", icon: Crown, permission: "tiers:manage" },
  { href: "/admin/events", label: "Events", icon: CalendarRange, permission: "programme:manage" },
  { href: "/admin/programme", label: "Programme", icon: ListOrdered, permission: "programme:manage" },
  { href: "/admin/tickets", label: "Tickets", icon: Ticket, permission: "tickets:view" },
  { href: "/admin/access-logs", label: "QR / Access logs", icon: Activity, permission: "scans:view" },
  { href: "/admin/concierge", label: "Concierge", icon: ConciergeBell, permission: "concierge:view_all" },
  { href: "/admin/notifications", label: "Notifications", icon: Bell, permission: "notifications:send" },
  { href: "/admin/staff", label: "Staff", icon: UserCog, permission: "staff:manage" },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList, permission: "audit:view" },
  { href: "/admin/settings", label: "Settings", icon: Settings, permission: "settings:manage" },
];

export function AdminNav({ allowed, showScanner }: { allowed: Permission[]; showScanner: boolean }) {
  return <AdminNavFrame allowed={allowed} showScanner={showScanner} pathname={usePathname()} />;
}

export function AdminNavFrame({ allowed, showScanner, pathname }: { allowed: Permission[]; showScanner: boolean; pathname: string | null }) {
  const items = ADMIN_NAV.filter((i) => allowed.includes(i.permission));
  const isActive = (href: string) => pathname !== null && (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 lg:flex-col lg:overflow-visible">
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
            isActive(href) ? "bg-white/10 text-pearl" : "text-pearl-dim hover:bg-white/5 hover:text-pearl",
          )}
        >
          <Icon className="size-4" strokeWidth={1.6} aria-hidden />
          {label}
        </Link>
      ))}
      {showScanner && (
        <Link href="/staff/scanner" className="flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-pearl-dim hover:bg-white/5 hover:text-pearl lg:mt-4">
          <ScanLine className="size-4" strokeWidth={1.6} aria-hidden />
          Open scanner
        </Link>
      )}
    </nav>
  );
}
