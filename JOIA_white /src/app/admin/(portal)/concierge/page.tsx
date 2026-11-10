import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listConciergeTeam, listRequestsStaff } from "@/services/concierge.service";
import { AdminDataTable, AdminPageHeader, FilterBar, FilterInput, FilterSelect } from "@/components/admin/admin-data-table";
import { StatusBadge, TierBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { CONCIERGE_CATEGORY_LABELS, CONCIERGE_STATUS_STAFF_LABELS } from "@/domain/concierge";
import { pickCurrentMembership } from "@/domain/membership";
import { formatDateTime, cn } from "@/lib/utils";
import { sp, spEnum, spPage, withParams, type SP } from "@/lib/search-params";
import { CONCIERGE_CATEGORIES, CONCIERGE_STATUSES } from "@/validators/concierge";

export const metadata: Metadata = { title: "Concierge" };

export default function ConciergeAdminPage({ searchParams }: PageProps<"/admin/concierge">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={8} />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("concierge:view_all");
  const params = await searchParams;
  const status = spEnum(params, "status", [...CONCIERGE_STATUSES, "OPEN"] as const) ?? (sp(params, "status") === "ALL" ? undefined : "OPEN");
  const [data, team] = await Promise.all([
    listRequestsStaff(actor, { status, category: spEnum(params, "category", CONCIERGE_CATEGORIES), assignedTo: sp(params, "assigned"), q: sp(params, "q"), page: spPage(params) }),
    listConciergeTeam(),
  ]);
  const lanes = ["NEW", "IN_PROGRESS", "WAITING_FOR_MEMBER", "CONFIRMED", "COMPLETED", "CANCELLED"] as const;

  return (
    <>
      <AdminPageHeader eyebrow="Service" title="Concierge" description="Requests from members. New requests are highlighted; replies and status changes notify the member." />
      <nav aria-label="Status lanes" className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Link href={withParams("/admin/concierge", params, { status: "OPEN", page: undefined })} className={cn("rounded-xl border bg-white p-3", status === "OPEN" ? "border-ink" : "border-black/8")}>
          <p className="text-[10px] uppercase tracking-[0.16em] text-black/50">All open</p>
          <p className="font-display text-2xl">{(data.counts.NEW ?? 0) + (data.counts.IN_PROGRESS ?? 0) + (data.counts.WAITING_FOR_MEMBER ?? 0) + (data.counts.CONFIRMED ?? 0)}</p>
        </Link>
        {lanes.map((l) => (
          <Link key={l} href={withParams("/admin/concierge", params, { status: l, page: undefined })} className={cn("rounded-xl border bg-white p-3", status === l ? "border-ink" : "border-black/8")}>
            <p className="text-[10px] uppercase tracking-[0.16em] text-black/50">{CONCIERGE_STATUS_STAFF_LABELS[l]}</p>
            <p className={cn("font-display text-2xl", l === "NEW" && (data.counts.NEW ?? 0) > 0 && "text-ruby")}>{data.counts[l] ?? 0}</p>
          </Link>
        ))}
      </nav>
      <FilterBar action="/admin/concierge">
        <input type="hidden" name="status" value={status ?? "ALL"} />
        <FilterInput label="Search" name="q" defaultValue={sp(params, "q")} placeholder="Reference, subject, member" />
        <FilterSelect label="Category" name="category" defaultValue={sp(params, "category")} options={CONCIERGE_CATEGORIES.map((c) => ({ value: c, label: CONCIERGE_CATEGORY_LABELS[c] }))} />
        <FilterSelect label="Assigned" name="assigned" defaultValue={sp(params, "assigned")} options={[{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...team.map((t) => ({ value: t.id, label: t.name }))]} />
      </FilterBar>
      <AdminDataTable
        caption="Concierge requests"
        rows={data.rows}
        rowKey={(r) => r.id}
        empty="No requests here."
        pagination={{ page: data.page, pageSize: data.pageSize, total: data.total, href: (p) => withParams("/admin/concierge", params, { page: p }) }}
        columns={[
          {
            header: "Request",
            cell: (r) => (
              <Link href={`/admin/concierge/${r.id}`} className="block hover:text-ruby">
                <span className={cn(r.status === "NEW" && "font-semibold")}>{r.subject}</span>
                <span className="block text-xs text-black/50">{r.reference} · {CONCIERGE_CATEGORY_LABELS[r.category]}</span>
              </Link>
            ),
          },
          {
            header: "Member",
            cell: (r) => {
              const m = pickCurrentMembership(r.member.memberships);
              return (
                <span className="flex items-center gap-2">
                  {r.member.firstName} {r.member.lastName}
                  {m && <TierBadge name={m.tier.displayName} theme={m.tier.cardTheme} />}
                </span>
              );
            },
          },
          { header: "Status", cell: (r) => <StatusBadge status={r.status} label={CONCIERGE_STATUS_STAFF_LABELS[r.status]} /> },
          { header: "Priority", cell: (r) => <StatusBadge status={r.priority} /> },
          { header: "Assigned", cell: (r) => r.assignedTo?.name ?? <span className="text-black/40">—</span> },
          { header: "Updated", cell: (r) => <span className="text-xs text-black/55">{formatDateTime(r.updatedAt)}</span> },
        ]}
      />
    </>
  );
}
