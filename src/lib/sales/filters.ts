/**
 * The sales pages' filters, from and to the address bar (?range=30d&status=paid ...).
 * Dates are days in the shop's time zone (SHOP_TIMEZONE, Asia/Dubai), as the orders are counted.
 */
import type { SP } from "@/lib/search-params";

export const SALES_TIMEZONE = process.env.SHOP_TIMEZONE || "Asia/Dubai";
export const PER_PAGE = 25;

export const ORDER_STATUSES = ["pending", "paid", "declined", "cancelled", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const RANGES = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "custom", label: "Custom dates" },
] as const;
export type Range = (typeof RANGES)[number]["id"];

export type SalesFilters = {
  range: Range;
  from: string; // YYYY-MM-DD, "" for no limit
  to: string;
  status: string;
  product: string;
  tier: string;
  country: string;
  q: string;
  page: number;
};

function one(v: string | string[] | undefined, max = 100): string {
  return (Array.isArray(v) ? v[0] || "" : v || "").trim().slice(0, max);
}

export function isDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
}

/** Today in the shop's time zone, YYYY-MM-DD. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SALES_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
}

const PRESET_DAYS: Record<string, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

export function readSalesFilters(params: SP, now = new Date()): SalesFilters {
  let range = one(params.range) as Range;
  if (!RANGES.some((r) => r.id === range)) range = "all";
  // dates filled in without picking "Custom dates"
  if (range === "all" && (isDay(one(params.from)) || isDay(one(params.to)))) range = "custom";
  let from = "";
  let to = "";
  if (PRESET_DAYS[range]) {
    to = today(now);
    from = addDays(to, 1 - PRESET_DAYS[range]);
  } else if (range === "custom") {
    from = isDay(one(params.from)) ? one(params.from) : "";
    to = isDay(one(params.to)) ? one(params.to) : "";
    if (from && to && from > to) [from, to] = [to, from];
    if (!from && !to) range = "all";
  }
  const page = parseInt(one(params.page), 10);
  const status = one(params.status, 20);
  return {
    range,
    from,
    to,
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? status : "",
    product: one(params.product, 100),
    tier: one(params.tier, 50),
    country: one(params.country, 60),
    q: one(params.q),
    page: page > 0 ? page : 1,
  };
}

/** The period just before a dated one, as long as it, for the change figures. */
export function previousPeriod(f: SalesFilters): { from: string; to: string } | null {
  if (!f.from || !f.to) return null;
  const n = daysBetween(f.from, f.to);
  return { from: addDays(f.from, -n), to: addDays(f.from, -1) };
}

/** This page's own query string for these filters (with changes), for links. */
export function salesQuery(f: SalesFilters, changes: Partial<SalesFilters> = {}): string {
  const g = { ...f, ...changes };
  const p = new URLSearchParams();
  if (g.range !== "all") p.set("range", g.range);
  if (g.range === "custom") {
    if (g.from) p.set("from", g.from);
    if (g.to) p.set("to", g.to);
  }
  (["status", "product", "tier", "country", "q"] as const).forEach((k) => {
    if (g[k]) p.set(k, g[k]);
  });
  if (g.page > 1) p.set("page", String(g.page));
  const s = p.toString();
  return s ? "?" + s : "";
}

export function isFiltered(f: SalesFilters): boolean {
  return f.range !== "all" || !!(f.status || f.product || f.tier || f.country || f.q);
}
