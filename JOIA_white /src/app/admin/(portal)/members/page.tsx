import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { listMembers } from "@/services/member.service";
import { listTiers } from "@/services/membership.service";
import { AdminDataTable, AdminPageHeader, FilterBar, FilterInput, FilterSelect } from "@/components/admin/admin-data-table";
import { StatusBadge, TierBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";
import { MEMBERSHIP_STATUSES } from "@/validators/admin";
import { sp, spEnum, spPage, withParams, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Members searchParams={searchParams} />
    </Suspense>
  );
}

async function Members({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("members:view");
  const params = await searchParams;
  const [data, tiers] = await Promise.all([
    listMembers(actor, {
      q: sp(params, "q"),
      tierId: sp(params, "tier"),
      status: spEnum(params, "status", [...MEMBERSHIP_STATUSES, "NONE"] as const),
      account: spEnum(params, "account", ["PENDING_ACTIVATION", "ACTIVE", "DISABLED"] as const),
      page: spPage(params),
    }),
    listTiers({ includeInactive: true }),
  ]);
  return (
    <>
      <AdminPageHeader
        eyebrow="Club"
        title="Members"
        description={`${data.total} member${data.total === 1 ? "" : "s"}`}
        actions={
          can(actor.role, "members:manage") && (
            <Link href="/admin/members/new" className={buttonClasses("primary", "sm")}>
              <Plus className="size-4" aria-hidden /> New member
            </Link>
          )
        }
      />
      <FilterBar action="/admin/members">
        <FilterInput label="Search" name="q" defaultValue={sp(params, "q")} placeholder="Name, email, number, company" />
        <FilterSelect label="Tier" name="tier" defaultValue={sp(params, "tier")} options={tiers.map((t) => ({ value: t.id, label: t.displayName }))} />
        <FilterSelect label="Membership" name="status" defaultValue={sp(params, "status")} options={[...MEMBERSHIP_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() })), { value: "NONE", label: "no membership" }]} />
        <FilterSelect label="Account" name="account" defaultValue={sp(params, "account")} options={[{ value: "PENDING_ACTIVATION", label: "awaiting activation" }, { value: "ACTIVE", label: "active" }, { value: "DISABLED", label: "disabled" }]} />
      </FilterBar>
      <AdminDataTable
        caption="Members"
        rows={data.rows}
        rowKey={(m) => m.id}
        empty="No members match these filters."
        pagination={{ page: data.page, pageSize: data.pageSize, total: data.total, href: (p) => withParams("/admin/members", params, { page: p }) }}
        columns={[
          {
            header: "Member",
            cell: (m) => (
              <Link href={`/admin/members/${m.id}`} className="block hover:text-ruby">
                <span className="font-medium">{m.firstName} {m.lastName}</span>
                <span className="block text-xs text-black/50">{m.user.email}</span>
              </Link>
            ),
          },
          { header: "Number", cell: (m) => <span className="font-mono text-xs">{m.membershipNumber}</span> },
          { header: "Tier", cell: (m) => (m.currentMembership ? <TierBadge name={m.currentMembership.tier.displayName} theme={m.currentMembership.tier.cardTheme} /> : "—") },
          { header: "Membership", cell: (m) => (m.currentMembership ? <StatusBadge status={m.currentMembership.status} /> : <span className="text-xs text-black/40">none</span>) },
          {
            header: "Account",
            cell: (m) => (
              <span className="flex flex-col gap-1">
                <StatusBadge status={m.user.status} />
                {m.deletionRequestedAt && <StatusBadge status="DELETION" label="deletion requested" tone="danger" />}
              </span>
            ),
          },
          { header: "Tickets", cell: (m) => m._count.tickets, className: "text-right" },
          { header: "Company", cell: (m) => <span className="text-black/60">{m.company ?? "—"}</span> },
        ]}
      />
    </>
  );
}
