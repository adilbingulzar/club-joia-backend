import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { listPreRegistrations } from "@/services/sales.service";
import { AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { SalesTabs } from "@/components/admin/sales-parts";
import { LoadingSkeleton } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";
import { count, dateTime } from "@/lib/sales/format";
import { sp, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "Pre-registrations" };

const TIERS = ["Ruby Red", "Pearly White", "Ultra Black", "Not sure yet"];

export default function RegistrationsPage({ searchParams }: PageProps<"/admin/sales/registrations">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={6} />}>
      <Registrations searchParams={searchParams} />
    </Suspense>
  );
}

async function Registrations({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("sales:view");
  const q = (sp(await searchParams, "q") ?? "").slice(0, 100);
  const data = await listPreRegistrations(actor, q);
  const tiers = TIERS.filter((t) => data.byTier[t]).map((t) => " · " + t + ": " + count(data.byTier[t])).join("");

  return (
    <>
      <AdminPageHeader
        eyebrow="Website"
        title="Pre-registrations"
        description={count(data.total) + " in total" + tiers + " · read only"}
        actions={
          <a href={"/admin/sales/registrations/export" + (q ? "?q=" + encodeURIComponent(q) : "")} download className={buttonClasses("outline", "sm")}>
            <Download className="size-4" aria-hidden /> Download CSV
          </a>
        }
      />
      <SalesTabs active="registrations" />
      {!data.available && (
        <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          The website&rsquo;s pre-registrations table isn&rsquo;t in this database yet. It is made when the website first runs on it.
        </p>
      )}
      <form action="/admin/sales/registrations" method="get" className="mb-5 flex flex-wrap items-end gap-3" aria-label="Search">
        <label className="text-[10px] uppercase tracking-[0.16em] text-black/50">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, email, phone or country"
            className="mt-1 block h-10 w-72 rounded-lg border border-black/12 bg-white px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-ruby"
          />
        </label>
        <button className="h-10 rounded-full bg-ink px-5 text-xs font-medium uppercase tracking-[0.14em] text-pearl hover:bg-black">Search</button>
        {q && (
          <Link href="/admin/sales/registrations" className="grid h-10 place-items-center rounded-full px-4 text-xs font-medium uppercase tracking-[0.14em] text-black/55 hover:bg-black/5">
            Reset
          </Link>
        )}
      </form>
      <AdminDataTable
        caption="Pre-registrations"
        rows={data.registrations.map((r, i) => ({ ...r, key: r.email + i }))}
        rowKey={(r) => r.key}
        empty={q ? "No pre-registrations match this search." : "No pre-registrations yet."}
        columns={[
          {
            header: "Registered",
            cell: (r) => (
              <span className="whitespace-nowrap tabular-nums">
                {dateTime(r.createdAt)}
                {r.updatedAt.getTime() !== r.createdAt.getTime() && <span className="block text-xs text-black/45">updated {dateTime(r.updatedAt)}</span>}
              </span>
            ),
          },
          {
            header: "Name",
            cell: (r) => (
              <span>
                {r.firstName} {r.lastName}
                <a href={"mailto:" + r.email} className="block text-xs text-black/50 hover:text-ruby">{r.email}</a>
              </span>
            ),
          },
          { header: "Mobile", cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.phone}</span> },
          { header: "Country", cell: (r) => r.country },
          { header: "Interest", cell: (r) => r.tier },
          { header: "Heard about us", cell: (r) => r.source || "—" },
          { header: "Message", cell: (r) => <span className="block max-w-72 whitespace-pre-wrap">{r.message || "—"}</span> },
          { header: "Marketing", cell: (r) => (r.marketing ? "Yes" : "No") },
        ]}
      />
    </>
  );
}
