import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/dal";
import { getSalesStats, listSalesOrders } from "@/services/sales.service";
import { AdminCard, AdminDataTable, AdminPageHeader } from "@/components/admin/admin-data-table";
import { BarList, ColumnChart, SegmentedBar } from "@/components/admin/sales-charts";
import { Delta, Empty, OrderStatusBadge, SalesTabs, TableView } from "@/components/admin/sales-parts";
import { LoadingSkeleton } from "@/components/joia/states";
import { buttonClasses } from "@/components/ui/button-styles";
import { isFiltered, ORDER_STATUSES, PER_PAGE, previousPeriod, RANGES, readSalesFilters, salesQuery, type SalesFilters } from "@/lib/sales/filters";
import { count, dateTime, dayLabel, itemsText, money, orderStatus, percent } from "@/lib/sales/format";
import { revenueSeries } from "@/lib/sales/series";
import type { SalesStats } from "@/services/sales.service";
import type { SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sales" };

const COUNTRIES_SHOWN = 8;

// each tier in its card's color (ink text where the color is light)
const TIER_COLORS: Record<string, { color: string; text: string }> = {
  ruby: { color: "#EF233C", text: "#FFFFFF" },
  pearl: { color: "#C9CCD1", text: "#050505" },
  black: { color: "#0B0B0C", text: "#F5F3EE" },
};
const FALLBACK = [{ color: "#8E9299", text: "#FFFFFF" }];

export default function SalesPage({ searchParams }: PageProps<"/admin/sales">) {
  return (
    <Suspense fallback={<LoadingSkeleton variant="list" lines={8} />}>
      <Sales searchParams={searchParams} />
    </Suspense>
  );
}

function rangeText(f: SalesFilters): string {
  const r = RANGES.find((x) => x.id === f.range)!;
  if (f.range === "all") return "All time";
  const dates =
    f.from && f.to ? (f.from === f.to ? dayLabel(f.from, true) : dayLabel(f.from) + " – " + dayLabel(f.to, true)) : f.from ? "from " + dayLabel(f.from, true) : "until " + dayLabel(f.to, true);
  return f.range === "custom" ? dates : r.label + " (" + dates + ")";
}

const field = "mt-1 block h-10 rounded-lg border border-black/12 bg-white px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-ruby";
const lbl = "text-[10px] uppercase tracking-[0.16em] text-black/50";

function Filters({ f, stats }: { f: SalesFilters; stats: SalesStats }) {
  const o = stats.options;
  return (
    <form action="/admin/sales" method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filters">
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
      <label className={lbl}>
        Status
        <select name="status" defaultValue={f.status} className={field + " min-w-32"}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {orderStatus(s).label}
            </option>
          ))}
        </select>
      </label>
      <label className={lbl}>
        Tier
        <select name="tier" defaultValue={f.tier} className={field + " min-w-32"}>
          <option value="">All tiers</option>
          {o.tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className={lbl}>
        Ticket
        <select name="product" defaultValue={f.product} className={field + " min-w-40"}>
          <option value="">All tickets</option>
          {o.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className={lbl}>
        Country
        <select name="country" defaultValue={f.country} className={field + " min-w-36"}>
          <option value="">All countries</option>
          {o.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className={lbl + " min-w-56 flex-1"}>
        Search
        <input type="search" name="q" defaultValue={f.q} placeholder="Order, name, email or phone" className={field + " w-full"} />
      </label>
      <div className="flex gap-2">
        <button className="h-10 rounded-full bg-ink px-5 text-xs font-medium uppercase tracking-[0.14em] text-pearl hover:bg-black">Apply</button>
        {isFiltered(f) && (
          <Link href="/admin/sales" className="grid h-10 place-items-center rounded-full px-4 text-xs font-medium uppercase tracking-[0.14em] text-black/55 hover:bg-black/5">
            Reset
          </Link>
        )}
      </div>
    </form>
  );
}

function Kpi({ label, value, children, lead }: { label: string; value: string; children?: React.ReactNode; lead?: boolean }) {
  return (
    <div className={"rounded-2xl border p-5 " + (lead ? "border-ink bg-ink text-pearl" : "border-black/8 bg-white")}>
      <p className={"text-[10px] font-medium uppercase tracking-[0.2em] " + (lead ? "text-pearl-muted" : "text-black/50")}>{label}</p>
      <p className="mt-3 font-display text-3xl tabular-nums">{value}</p>
      {children}
    </div>
  );
}

async function Sales({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePermissionPage("sales:view");
  const f = readSalesFilters(await searchParams);
  const prev = previousPeriod(f);
  const [stats, before, list] = await Promise.all([
    getSalesStats(actor, f),
    prev ? getSalesStats(actor, { ...f, ...prev }) : Promise.resolve(null),
    listSalesOrders(actor, f, f.page, PER_PAGE),
  ]);

  const cur = stats.currency;
  const t = stats.totals;
  const b = before?.totals;
  const days = revenueSeries(stats.byDay, f.from, f.to);
  const products = stats.byProduct.filter((p) => p.tickets > 0).sort((x, y) => y.tickets - x.tickets || y.revenue - x.revenue);
  const countries = stats.byCountry.slice(0, COUNTRIES_SHOWN);
  const others = stats.byCountry.slice(COUNTRIES_SHOWN);
  if (others.length) {
    countries.push({ country: "Other (" + others.length + ")", orders: others.reduce((s, c) => s + c.orders, 0), revenue: others.reduce((s, c) => s + c.revenue, 0) });
  }
  const tierColor = (theme: string, i: number) => TIER_COLORS[theme] ?? FALLBACK[i % FALLBACK.length];
  const weekly = days.length > 0 && days[0].from !== days[0].to;

  return (
    <>
      <AdminPageHeader
        eyebrow="Website"
        title="Ticket sales"
        description={rangeText(f) + " · days and times in Dubai time (GST) · read only"}
        actions={
          <a href={"/admin/sales/export" + salesQuery(f, { page: 1 })} download className={buttonClasses("outline", "sm")}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <SalesTabs active="sales" />
      {!stats.available && (
        <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          The website&rsquo;s orders table (shop_orders) isn&rsquo;t in this database yet. It is made when the website first runs on it.
        </p>
      )}
      <Filters f={f} stats={stats} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Revenue" value={money(t.revenue, cur)} lead>
          <Delta now={t.revenue} before={b?.revenue} />
          <span className="mt-1 block text-xs text-pearl-dim">paid orders only</span>
        </Kpi>
        <Kpi label="Paid orders" value={count(t.paid)}>
          <Delta now={t.paid} before={b?.paid} />
        </Kpi>
        <Kpi label="Tickets sold" value={count(t.tickets)}>
          <Delta now={t.tickets} before={b?.tickets} />
        </Kpi>
        <Kpi label="Average order" value={money(t.average, cur)}>
          <Delta now={t.average} before={b?.average} />
        </Kpi>
        <Kpi label="Paid of started" value={percent(t.paid, t.orders)}>
          <span className="mt-1 block text-xs text-black/45">
            {count(t.paid)} of {count(t.orders)} orders · {count(t.buyers)} buyers
          </span>
        </Kpi>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AdminCard title={`Revenue by ${weekly ? "week" : "day"} · ${cur}, paid orders`} className="lg:col-span-2">
          {days.length && t.revenue > 0 ? (
            <ColumnChart
              label={"Revenue by day, " + cur}
              as="money"
              currency={cur}
              points={days.map((d) => ({
                key: d.key,
                label: d.from === d.to ? d.label : d.label + " – " + dayLabel(d.to),
                value: d.revenue,
                detail: count(d.paid) + " paid of " + count(d.orders) + " orders",
              }))}
            />
          ) : (
            <Empty>No paid orders in this period.</Empty>
          )}
          <TableView
            head={["Day", "Revenue (" + cur + ")", "Paid orders", "Orders"]}
            rows={days.map((d) => [d.from === d.to ? dayLabel(d.from, true) : dayLabel(d.from) + " – " + dayLabel(d.to, true), count(d.revenue), d.paid, d.orders])}
          />
        </AdminCard>

        <AdminCard title="Tickets sold by ticket · paid, with revenue">
          {products.length ? (
            <BarList label="Tickets sold by ticket" as="count" currency={cur} rows={products.map((p) => ({ key: p.id, label: p.name, value: p.tickets, detail: money(p.revenue, cur) }))} />
          ) : (
            <Empty>No tickets sold in this period.</Empty>
          )}
          <TableView head={["Ticket", "Price (" + cur + ")", "Sold", "Revenue (" + cur + ")"]} rows={stats.byProduct.map((p) => [p.name, count(p.price), p.tickets, count(p.revenue)])} />
        </AdminCard>

        <AdminCard title="Revenue by membership tier">
          <SegmentedBar
            label="Revenue by membership tier"
            as="money"
            currency={cur}
            parts={stats.byTier.map((x, i) => ({ key: x.tier, label: x.name, value: x.revenue, detail: count(x.tickets) + " tickets", ...tierColor(x.theme, i) }))}
          />
          <div className="mt-4 divide-y divide-black/6 text-sm">
            {stats.byTier.map((x, i) => (
              <div key={x.tier} className="flex items-center justify-between gap-3 py-2">
                <span className="inline-flex items-center gap-2">
                  <i className="inline-block size-2.5 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: tierColor(x.theme, i).color }} />
                  {x.name}
                </span>
                <span className="tabular-nums text-black/50">{count(x.tickets)} tickets</span>
                <span className="tabular-nums">{money(x.revenue, cur)}</span>
              </div>
            ))}
          </div>
        </AdminCard>

        <AdminCard title={`Orders by status · ${count(t.orders)} ${t.orders === 1 ? "order" : "orders"}`}>
          {t.orders > 0 && (
            <div className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {stats.byStatus
                .filter((s) => s.orders > 0)
                .map((s) => (
                  <div key={s.status} style={{ flex: s.orders, background: orderStatus(s.status).color }} />
                ))}
            </div>
          )}
          <div className="divide-y divide-black/6 text-sm">
            {stats.byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between gap-3 py-2">
                <Link href={"/admin/sales" + salesQuery(f, { status: s.status, page: 1 })}>
                  <OrderStatusBadge status={s.status} />
                </Link>
                <span className="tabular-nums text-black/50">{money(s.amount, cur)}</span>
                <span className="tabular-nums">
                  {count(s.orders)} · {percent(s.orders, t.orders)}
                </span>
              </div>
            ))}
          </div>
        </AdminCard>

        <AdminCard title="Revenue by country · paid orders, buyer’s country">
          {countries.length ? (
            <BarList
              label="Revenue by country"
              as="money"
              currency={cur}
              rows={countries.map((c) => ({ key: c.country, label: c.country, value: c.revenue, detail: count(c.orders) + (c.orders === 1 ? " order" : " orders") }))}
            />
          ) : (
            <Empty>No paid orders in this period.</Empty>
          )}
          <TableView head={["Country", "Paid orders", "Revenue (" + cur + ")"]} rows={stats.byCountry.map((c) => [c.country, c.orders, count(c.revenue)])} />
        </AdminCard>

        <AdminCard title="Admissions sold · tickets issued per day and extra, from paid orders" className="lg:col-span-2">
          {stats.byTicketType.length ? (
            <BarList label="Admissions sold" as="count" currency={cur} rows={stats.byTicketType.map((x) => ({ key: x.code, label: x.name, value: x.tickets }))} />
          ) : (
            <Empty>No admissions sold in this period.</Empty>
          )}
          <TableView head={["Admission", "Code", "Tickets"]} rows={stats.byTicketType.map((x) => [x.name, x.code, x.tickets])} />
        </AdminCard>
      </div>

      <h2 className="mb-3 mt-10 text-[11px] font-medium uppercase tracking-[0.2em] text-black/55">Orders</h2>
      <AdminDataTable
        caption="Orders"
        rows={list.orders}
        rowKey={(o) => o.ref}
        empty="No orders match these filters."
        pagination={{ page: list.page, pageSize: PER_PAGE, total: list.total, href: (p) => "/admin/sales" + salesQuery(f, { page: p }) }}
        columns={[
          { header: "Date", cell: (o) => <span className="whitespace-nowrap tabular-nums">{dateTime(o.createdAt)}</span> },
          {
            header: "Order",
            cell: (o) => (
              <Link href={`/admin/sales/orders/${encodeURIComponent(o.ref)}`} className="font-mono text-xs hover:text-ruby">
                {o.ref}
              </Link>
            ),
          },
          {
            header: "Buyer",
            cell: (o) => (
              <span>
                {o.buyer.name}
                <span className="block text-xs text-black/50">{o.buyer.email}</span>
              </span>
            ),
          },
          { header: "Country", cell: (o) => <span className="capitalize">{o.buyer.country}</span> },
          {
            header: "Tickets",
            cell: (o) => (
              <span>
                {itemsText(o.items)}
                {o.error && <span className="block text-xs text-danger">⚠ {o.error}</span>}
              </span>
            ),
          },
          { header: "Amount", cell: (o) => <span className="whitespace-nowrap tabular-nums">{money(o.amount, o.currency)}</span>, className: "text-right" },
          { header: "Status", cell: (o) => <OrderStatusBadge status={o.status} /> },
        ]}
      />
    </>
  );
}
