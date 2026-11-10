import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listScanLogs } from "@/services/qr.service";
import { db } from "@/lib/db";
import { AdminDataTable, AdminPageHeader, FilterBar, FilterSelect } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/joia/badges";
import { LoadingSkeleton } from "@/components/joia/states";
import { formatDateTime } from "@/lib/utils";
import { sp, spEnum, spPage, withParams, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "Access logs" };

const RESULTS = ["VALID", "ALREADY_USED", "NOT_VALID_YET", "EXPIRED", "REVOKED", "INVALID", "WRONG_ACCESS_ZONE", "SUSPENDED"] as const;
const ACTIONS = ["VALIDATE", "CHECK_IN", "DENY"] as const;

export default function AccessLogsPage({ searchParams }: PageProps<"/admin/access-logs">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={8} />}>
      <Logs searchParams={searchParams} />
    </Suspense>
  );
}

async function Logs({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("scans:view");
  const params = await searchParams;
  const [data, zones] = await Promise.all([
    listScanLogs(actor, { result: spEnum(params, "result", RESULTS), action: spEnum(params, "action", ACTIONS), zoneId: sp(params, "zone"), page: spPage(params) }),
    db.accessZone.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <AdminPageHeader eyebrow="Security" title="QR / Access logs" description="Every scan attempt — including unrecognised and forged codes — is recorded here." />
      <FilterBar action="/admin/access-logs">
        <FilterSelect label="Result" name="result" defaultValue={sp(params, "result")} options={RESULTS.map((r) => ({ value: r, label: r.toLowerCase().replace(/_/g, " ") }))} />
        <FilterSelect label="Action" name="action" defaultValue={sp(params, "action")} options={ACTIONS.map((r) => ({ value: r, label: r.toLowerCase().replace("_", " ") }))} />
        <FilterSelect label="Zone" name="zone" defaultValue={sp(params, "zone")} options={zones.map((z) => ({ value: z.id, label: z.name }))} />
      </FilterBar>
      <AdminDataTable
        caption="Scan log"
        rows={data.rows}
        rowKey={(l) => l.id}
        empty="No scans recorded."
        pagination={{ page: data.page, pageSize: data.pageSize, total: data.total, href: (p) => withParams("/admin/access-logs", params, { page: p }) }}
        columns={[
          { header: "Time", cell: (l) => <span className="whitespace-nowrap text-xs">{formatDateTime(l.scanTime)}</span> },
          { header: "Result", cell: (l) => <StatusBadge status={l.result} /> },
          { header: "Action", cell: (l) => <span className="text-xs">{l.action.toLowerCase().replace("_", " ")} · {l.method.toLowerCase()}</span> },
          { header: "Member", cell: (l) => (l.member ? <Link href={`/admin/members/${l.member.id}`} className="hover:text-ruby">{l.member.firstName} {l.member.lastName}</Link> : <span className="text-black/40">—</span>) },
          { header: "Ticket", cell: (l) => (l.ticket ? <Link href={`/admin/tickets/${l.ticket.id}`} className="font-mono text-xs hover:text-ruby">{l.ticket.ticketNumber}</Link> : "—") },
          { header: "Zone", cell: (l) => l.zone?.name ?? "—" },
          { header: "Staff", cell: (l) => l.staff.name },
          { header: "Reason", cell: (l) => <span className="font-mono text-[11px] text-black/55">{l.reason}</span> },
        ]}
      />
    </>
  );
}
