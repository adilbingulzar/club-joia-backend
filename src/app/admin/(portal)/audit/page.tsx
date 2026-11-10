import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { auditEntityTypes, listAuditLogs } from "@/services/audit.service";
import { AdminDataTable, AdminPageHeader, FilterBar, FilterInput, FilterSelect } from "@/components/admin/admin-data-table";
import { LoadingSkeleton } from "@/components/joia/states";
import { formatDateTime } from "@/lib/utils";
import { sp, spPage, withParams, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={8} />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

function Diff({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return <span className="text-black/35">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-ruby">View</summary>
      <div className="mt-2 grid max-w-xl gap-2 md:grid-cols-2">
        {before != null && <pre className="max-h-60 overflow-auto rounded-lg bg-black/[0.04] p-2 text-[10px]">{JSON.stringify(before, null, 2)}</pre>}
        {after != null && <pre className="max-h-60 overflow-auto rounded-lg bg-black/[0.04] p-2 text-[10px]">{JSON.stringify(after, null, 2)}</pre>}
      </div>
    </details>
  );
}

async function Audit({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("audit:view");
  const params = await searchParams;
  const [data, types] = await Promise.all([
    listAuditLogs(actor, { entityType: sp(params, "entity"), action: sp(params, "action"), entityId: sp(params, "id"), page: spPage(params) }),
    auditEntityTypes(actor),
  ]);
  return (
    <>
      <AdminPageHeader eyebrow="Security" title="Audit log" description="Append-only record of every sensitive change. Entries cannot be edited or deleted — the database rejects it." />
      <FilterBar action="/admin/audit">
        <FilterSelect label="Entity" name="entity" defaultValue={sp(params, "entity")} options={types.map((t) => ({ value: t, label: t }))} />
        <FilterInput label="Action contains" name="action" defaultValue={sp(params, "action")} placeholder="e.g. revoke" />
        <FilterInput label="Entity id" name="id" defaultValue={sp(params, "id")} />
      </FilterBar>
      <AdminDataTable
        caption="Audit entries"
        rows={data.rows}
        rowKey={(r) => r.id}
        empty="No entries."
        pagination={{ page: data.page, pageSize: data.pageSize, total: data.total, href: (p) => withParams("/admin/audit", params, { page: p }) }}
        columns={[
          { header: "Time", cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</span> },
          { header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
          { header: "Entity", cell: (r) => <span className="text-xs">{r.entityType} <span className="font-mono text-black/45">{r.entityId?.slice(-8)}</span></span> },
          { header: "Actor", cell: (r) => <span className="text-xs">{r.actor ? `${r.actor.name} (${r.actor.role.toLowerCase()})` : "system"}</span> },
          { header: "IP", cell: (r) => <span className="font-mono text-[11px] text-black/50">{r.ipAddress ?? "—"}</span> },
          { header: "Change", cell: (r) => <Diff before={r.beforeData} after={r.afterData} /> },
        ]}
      />
    </>
  );
}
