import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { getVisitStats, listDayVisitors } from "@/services/visits.service";
import { AdminCard, AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { BarList, ColumnChart } from "@/components/admin/sales-charts";
import { Empty, SalesTabs, TableView } from "@/components/admin/sales-parts";
import { LoadingSkeleton } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";
import { isDay, RANGES, readSalesFilters, today, type SalesFilters } from "@/lib/sales/filters";
import { count, dayLabel } from "@/lib/sales/format";
import { pageLabel, sourceLabel, visitSeries } from "@/lib/sales/visits";
import { sp, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "Website visits" };

export default function VisitsPage({ searchParams }: PageProps<"/admin/sales/visits">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={8} />}>
      <Visits searchParams={searchParams} />
    </Suspense>
  );
}

const field = "mt-1 block h-10 rounded-lg border border-black/12 bg-white px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-ruby";
const lbl = "text-[10px] uppercase tracking-[0.16em] text-black/50";
const time = new Intl.DateTimeFormat("en-GB", { timeZone: process.env.SHOP_TIMEZONE || "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false });

function rangeText(f: SalesFilters): string {
  if (f.range === "all") return "All time";
  const dates =
    f.from && f.to ? (f.from === f.to ? dayLabel(f.from, true) : dayLabel(f.from) + " – " + dayLabel(f.to, true)) : f.from ? "from " + dayLabel(f.from, true) : "until " + dayLabel(f.to, true);
  return f.range === "custom" ? dates : RANGES.find((x) => x.id === f.range)!.label + " (" + dates + ")";
}

/** This page's query string: the period, and the day of the visitor list. */
function visitsQuery(f: SalesFilters, day?: string): string {
  const p = new URLSearchParams();
  if (f.range !== "all") p.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (day) p.set("day", day);
  const s = p.toString();
  return s ? "?" + s : "";
}

function Kpi({ label, value, note, lead }: { label: string; value: string; note?: string; lead?: boolean }) {
  return (
    <div className={"rounded-2xl border p-5 " + (lead ? "border-ink bg-ink text-pearl" : "border-black/8 bg-white")}>
      <p className={"text-[10px] font-medium uppercase tracking-[0.2em] " + (lead ? "text-pearl-muted" : "text-black/50")}>{label}</p>
      <p className="mt-3 font-display text-3xl tabular-nums">{value}</p>
      {note && <span className={"mt-1 block text-xs " + (lead ? "text-pearl-dim" : "text-black/45")}>{note}</span>}
    </div>
  );
}

async function Visits({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("sales:view");
  const params = await searchParams;
  const f = readSalesFilters(params);
  const asked = (sp(params, "day") ?? "").slice(0, 10);
  const day = isDay(asked) ? asked : today();
  const [stats, list] = await Promise.all([getVisitStats(actor, f), listDayVisitors(actor, day)]);
  const t = stats.totals;
  const days = visitSeries(stats.byDay, f.from, f.to);
  const weekly = days.length > 0 && days[0].from !== days[0].to;
  const visitorsToday = stats.byDay.find((d) => d.day === today())?.visitors;

  return (
    <>
      <AdminPageHeader
        eyebrow="Website"
        title="Website visits"
        description={rangeText(f) + " · days in Dubai time (GST) · bots left out · read only"}
        actions={
          can(actor.role, "sales:export") && (
            <a href={"/admin/sales/visits/export" + visitsQuery(f)} download className={buttonClasses("outline", "sm")}>
              <Download className="size-4" aria-hidden /> Daily report CSV
            </a>
          )
        }
      />
      <SalesTabs active="visits" />
      {!stats.available && (
        <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          The website&rsquo;s visits table (shop_visits) isn&rsquo;t in this database yet. It is made when the website first counts a visit.
        </p>
      )}

      <form action="/admin/sales/visits" method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Period">
        <label className={lbl}>
          Period
          <select name="range" defaultValue={f.range} className={field + " min-w-36"}>
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className={lbl}>
          From
          <input type="date" name="from" defaultValue={f.range === "custom" ? f.from : ""} className={field} />
        </label>
        <label className={lbl}>
          To
          <input type="date" name="to" defaultValue={f.range === "custom" ? f.to : ""} className={field} />
        </label>
        <input type="hidden" name="day" value={asked && isDay(asked) ? asked : ""} />
        <div className="flex gap-2">
          <button className="h-10 rounded-full bg-ink px-5 text-xs font-medium uppercase tracking-[0.14em] text-pearl hover:bg-black">Apply</button>
          {f.range !== "all" && (
            <Link href="/admin/sales/visits" className="grid h-10 place-items-center rounded-full px-4 text-xs font-medium uppercase tracking-[0.14em] text-black/55 hover:bg-black/5">
              Reset
            </Link>
          )}
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Visitors" value={count(t.visitors)} note="one person counted once a day" lead />
        <Kpi label="Page views" value={count(t.pageViews)} />
        <Kpi label="Pages per visitor" value={t.visitors ? (t.pageViews / t.visitors).toLocaleString("en-US", { maximumFractionDigits: 1 }) : "0"} />
        <Kpi label="Visitors today" value={count(visitorsToday ?? 0)} note={dayLabel(today(), true)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminCard title={`Visitors by ${weekly ? "week" : "day"}`} className="lg:col-span-2">
          {days.length && t.visitors > 0 ? (
            <ColumnChart
              label="Visitors by day"
              as="count"
              currency=""
              points={days.map((d) => ({
                key: d.key,
                label: d.from === d.to ? d.label : d.label + " – " + dayLabel(d.to),
                value: d.visitors,
                detail: count(d.pageViews) + " page views",
              }))}
            />
          ) : (
            <Empty>No visits in this period.</Empty>
          )}
          <TableView
            head={["Day", "Visitors", "Page views"]}
            rows={days.map((d) => [d.from === d.to ? dayLabel(d.from, true) : dayLabel(d.from) + " – " + dayLabel(d.to, true), d.visitors, d.pageViews])}
          />
        </AdminCard>

        <AdminCard title="Where visitors came from · their first page of the day">
          {stats.bySource.length ? (
            <BarList label="Visitors by source" as="count" currency="" rows={stats.bySource.map((s) => ({ key: s.source, label: sourceLabel(s.source), value: s.visitors }))} />
          ) : (
            <Empty>No visits in this period.</Empty>
          )}
          <TableView head={["Source", "Visitors"]} rows={stats.bySource.map((s) => [sourceLabel(s.source), s.visitors])} />
        </AdminCard>

        <AdminCard title="Pages · views, with visitors">
          {stats.byPage.length ? (
            <BarList
              label="Page views by page"
              as="count"
              currency=""
              rows={stats.byPage.map((p) => ({ key: p.path, label: pageLabel(p.path), value: p.views, detail: count(p.visitors) + (p.visitors === 1 ? " visitor" : " visitors") }))}
            />
          ) : (
            <Empty>No visits in this period.</Empty>
          )}
          <TableView head={["Page", "Views", "Visitors"]} rows={stats.byPage.map((p) => [pageLabel(p.path), p.views, p.visitors])} />
        </AdminCard>
      </div>

      <div className="mb-3 mt-10 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-black/55">
          Visitors on {dayLabel(day, true)} · {count(list.total)} {list.total === 1 ? "visitor" : "visitors"}
          {list.total > list.visitors.length && " · latest " + list.visitors.length + " shown"}
        </h2>
        <form action="/admin/sales/visits" method="get" className="flex items-end gap-2" aria-label="Day">
          {f.range !== "all" && <input type="hidden" name="range" value={f.range} />}
          {f.range === "custom" && f.from && <input type="hidden" name="from" value={f.from} />}
          {f.range === "custom" && f.to && <input type="hidden" name="to" value={f.to} />}
          <label className={lbl}>
            Day
            <input type="date" name="day" defaultValue={day} className={field} />
          </label>
          <button className="h-10 rounded-full bg-ink px-5 text-xs font-medium uppercase tracking-[0.14em] text-pearl hover:bg-black">Show</button>
        </form>
      </div>
      <AdminDataTable
        caption={"Visitors on " + dayLabel(day, true)}
        rows={list.visitors}
        rowKey={(v) => v.visitor}
        empty="No visitors on this day."
        columns={[
          {
            header: "Time (Dubai)",
            cell: (v) => (
              <span className="whitespace-nowrap tabular-nums">
                {time.format(v.first)}
                {v.last.getTime() - v.first.getTime() > 60000 && " – " + time.format(v.last)}
              </span>
            ),
          },
          { header: "Visitor", cell: (v) => <span className="font-mono text-xs text-black/55">{v.visitor.slice(0, 8)}</span> },
          { header: "Came from", cell: (v) => sourceLabel(v.source) },
          {
            header: "Pages (times opened)",
            cell: (v) => (
              <span className="flex flex-wrap gap-1.5">
                {v.pages.map((p) => (
                  <span key={p.path} className="whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-xs">
                    {pageLabel(p.path)}
                    {p.views > 1 && <b className="ml-1 tabular-nums">×{p.views}</b>}
                  </span>
                ))}
              </span>
            ),
          },
          { header: "Page views", cell: (v) => <span className="tabular-nums">{v.views}</span>, className: "text-right" },
        ]}
      />
    </>
  );
}
