import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { getDashboardStats } from "@/services/dashboard.service";
import { AdminCard, AdminPageHeader, StatCard } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/joia/badges";
import { cardTheme } from "@/styles/design-tokens";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminDashboard() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4 md:grid-cols-4" role="status">
          <span className="sr-only">Loading dashboard…</span>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-32 rounded-2xl" aria-hidden />
          ))}
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const actor = await requirePermissionPage("dashboard:view");
  const s = await getDashboardStats(actor);
  return (
    <>
      <AdminPageHeader
        eyebrow={s.event ? `${s.event.name} · today ${s.today}` : "Operations"}
        title="Dashboard"
        description="Live operational overview. Figures refresh on every visit."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total events" value={s.events.total} hint={`${s.events.live} published · ${s.events.draft} draft`} />
        <StatCard label="Ticket types" value={s.ticketTypeCount} hint={`across ${s.ticketTypesByEvent.length} event${s.ticketTypesByEvent.length === 1 ? "" : "s"}`} />
        <StatCard label="Total members" value={s.totalMembers} hint={s.pendingActivation ? `${s.pendingActivation} awaiting activation` : undefined} />
        <StatCard label="Active members" value={s.activeMembers} />
        {s.tiers.map((t) => (
          <StatCard key={t.id} label={t.name} value={t.count} hint="active memberships" accent={cardTheme(t.theme).base} />
        ))}
        <StatCard label="Tickets issued" value={s.ticketsIssued} />
        <StatCard label="Checked in today" value={s.checkedInToday} accent="#22A06B" />
        <StatCard label="Pending concierge" value={s.pendingConcierge} accent="#EF233C" />
        <StatCard label="Notifications sent" value={s.notificationsSent} />
      </div>

      <AdminCard title="Tickets by type" className="mt-6" actions={<Link href="/admin/events" className="text-xs text-ruby">Manage events</Link>}>
        {s.ticketTypesByEvent.length === 0 ? (
          <p className="py-6 text-center text-sm text-black/50">No ticket types yet.</p>
        ) : (
          <div className="space-y-5">
            {s.ticketTypesByEvent.map((ev) => (
              <div key={ev.eventId}>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/55">
                  <Link href={`/admin/tickets?event=${ev.eventId}`} className="hover:text-ruby">{ev.eventName}</Link>
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-black/45">
                        <th className="pb-2 font-medium">Ticket type</th>
                        <th className="pb-2 text-right font-medium">Issued</th>
                        <th className="pb-2 text-right font-medium">Used</th>
                        <th className="pb-2 text-right font-medium">Revoked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/6">
                      {ev.types.map((t) => (
                        <tr key={t.id}>
                          <td className="py-2">
                            <Link href={`/admin/tickets?event=${ev.eventId}&type=${t.id}`} className="hover:text-ruby">{t.name}</Link>{" "}
                            <span className="font-mono text-xs text-black/40">{t.code}</span>
                            {!t.active && <span className="ml-2 text-xs text-black/40">inactive</span>}
                          </td>
                          <td className="py-2 text-right tabular-nums">{t.issued}</td>
                          <td className="py-2 text-right tabular-nums">{t.used}</td>
                          <td className="py-2 text-right tabular-nums text-black/50">{t.revoked}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <AdminCard title="Latest scans" actions={<Link href="/admin/access-logs" className="text-xs text-ruby">All logs</Link>}>
          {s.recentScans.length === 0 ? (
            <p className="py-6 text-center text-sm text-black/50">No scans yet.</p>
          ) : (
            <ul className="divide-y divide-black/6 text-sm">
              {s.recentScans.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate">
                    {l.member ? `${l.member.firstName} ${l.member.lastName}` : "Unknown credential"}
                    <span className="text-black/45"> · {l.zone?.name ?? "—"} · {l.action.toLowerCase()}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StatusBadge status={l.result} />
                    <span className="text-xs text-black/45">{formatDateTime(l.scanTime)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
        <AdminCard title="Attention">
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between">
              <Link href="/admin/concierge?status=OPEN" className="hover:text-ruby">Open concierge requests</Link>
              <span className="font-medium">{s.pendingConcierge}</span>
            </li>
            <li className="flex justify-between">
              <Link href="/admin/members?account=PENDING_ACTIVATION" className="hover:text-ruby">Invitations not yet activated</Link>
              <span className="font-medium">{s.pendingActivation}</span>
            </li>
            <li className="flex justify-between">
              <Link href="/admin/members" className="hover:text-ruby">Data deletion requests</Link>
              <span className="font-medium">{s.deletionRequests}</span>
            </li>
          </ul>
        </AdminCard>
      </div>
    </>
  );
}
