import "server-only";
import { db } from "@/lib/db";
import { isDay } from "@/lib/sales/filters";
import type { VisitDay, VisitReportDay } from "@/lib/sales/visits";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * VisitsService — the website's page views, read only, for /admin/visits.
 *
 * The website (club-joia-300-next lib/visits.ts) saves one row per page view in `shop_visits`, in
 * this same database: the day (UAE date, as SHOP_TIMEZONE), an anonymous visitor code that changes
 * every day, the page and where the visit came from. It is the website's own table (not in the
 * Prisma schema), so it is read with raw SQL; before the website has made it, every figure is
 * empty and `available` is false.
 *
 * A visitor is one code on one day, so visitors over several days are the days' visitors added up.
 * A visitor's source for the day is that of their first page that day.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function num(v: unknown): number {
  return Number(typeof v === "bigint" ? v.toString() : v === null || v === undefined ? 0 : String(v)) || 0;
}

function missingTable(e: unknown): boolean {
  return /doesn't exist|1146|no such table/i.test(String((e as Error)?.message ?? e));
}

async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  return db.$queryRawUnsafe<Row[]>(sql, ...params);
}

export type VisitRange = { from: string; to: string }; // YYYY-MM-DD, "" for no limit

/** SQL conditions on shop_visits for the range (column names prefixed with p). */
function where(r: VisitRange, p = "") {
  const conds = ["1 = 1"];
  const params: unknown[] = [];
  if (isDay(r.from)) {
    conds.push(p + "day >= ?");
    params.push(r.from);
  }
  if (isDay(r.to)) {
    conds.push(p + "day <= ?");
    params.push(r.to);
  }
  return { sql: conds.join(" AND "), params };
}

const DAY = "DATE_FORMAT(day, '%Y-%m-%d')";

export type VisitStats = {
  available: boolean;
  totals: { visitors: number; pageViews: number };
  byDay: VisitDay[];
  bySource: { source: string; visitors: number }[];
  byPage: { path: string; views: number; visitors: number }[];
};

const EMPTY: VisitStats = { available: false, totals: { visitors: 0, pageViews: 0 }, byDay: [], bySource: [], byPage: [] };

export async function getVisitStats(actor: Actor, r: VisitRange): Promise<VisitStats> {
  requirePermission(actor, "visits:view");
  const w = where(r);
  const wv = where(r, "v.");
  let days: Row[], sources: Row[], pages: Row[];
  try {
    [days, sources, pages] = await Promise.all([
      query(`SELECT ${DAY} AS day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM shop_visits WHERE ${w.sql} GROUP BY day ORDER BY day`, w.params),
      query(
        `SELECT v.source, COUNT(*) AS visitors FROM shop_visits v
         JOIN (SELECT MIN(id) AS id FROM shop_visits WHERE ${w.sql} GROUP BY day, visitor) f ON f.id = v.id
         GROUP BY v.source ORDER BY visitors DESC, v.source`,
        w.params,
      ),
      // a page's visitors: distinct per day, added up over the days
      query(
        `SELECT path, SUM(views) AS views, COUNT(*) AS visitors FROM
           (SELECT v.day, v.visitor, v.path, COUNT(*) AS views FROM shop_visits v WHERE ${wv.sql} GROUP BY v.day, v.visitor, v.path) x
         GROUP BY path ORDER BY views DESC, path`,
        wv.params,
      ),
    ]);
  } catch (e) {
    if (missingTable(e)) return EMPTY;
    throw e;
  }
  const byDay = days.map((d) => ({ day: String(d.day), visitors: num(d.visitors), pageViews: num(d.views) }));
  return {
    available: true,
    totals: { visitors: byDay.reduce((s, d) => s + d.visitors, 0), pageViews: byDay.reduce((s, d) => s + d.pageViews, 0) },
    byDay,
    bySource: sources.map((s) => ({ source: String(s.source), visitors: num(s.visitors) })),
    byPage: pages.map((p) => ({ path: String(p.path), views: num(p.views), visitors: num(p.visitors) })),
  };
}

export type DayVisitor = {
  visitor: string;
  source: string;
  views: number;
  pages: { path: string; views: number }[];
  first: Date;
  last: Date;
};

/** One day's visitors: where each came from and which pages they opened how often, latest first. */
export async function listDayVisitors(actor: Actor, day: string, limit = 200): Promise<{ available: boolean; total: number; visitors: DayVisitor[] }> {
  requirePermission(actor, "visits:view");
  if (!isDay(day)) return { available: true, total: 0, visitors: [] };
  let rows: Row[], sources: Row[];
  try {
    [rows, sources] = await Promise.all([
      query("SELECT visitor, path, COUNT(*) AS views, MIN(created_at) AS first, MAX(created_at) AS last FROM shop_visits WHERE day = ? GROUP BY visitor, path", [day]),
      query(
        "SELECT v.visitor, v.source FROM shop_visits v JOIN (SELECT MIN(id) AS id FROM shop_visits WHERE day = ? GROUP BY visitor) f ON f.id = v.id",
        [day],
      ),
    ]);
  } catch (e) {
    if (missingTable(e)) return { available: false, total: 0, visitors: [] };
    throw e;
  }
  const source = new Map(sources.map((s) => [String(s.visitor), String(s.source)]));
  const by = new Map<string, DayVisitor>();
  for (const r of rows) {
    const id = String(r.visitor);
    const first = new Date(r.first);
    const last = new Date(r.last);
    let v = by.get(id);
    if (!v) by.set(id, (v = { visitor: id, source: source.get(id) ?? "direct", views: 0, pages: [], first, last }));
    v.views += num(r.views);
    v.pages.push({ path: String(r.path), views: num(r.views) });
    if (first < v.first) v.first = first;
    if (last > v.last) v.last = last;
  }
  const all = [...by.values()].sort((a, b) => b.last.getTime() - a.last.getTime());
  all.forEach((v) => v.pages.sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)));
  return { available: true, total: all.length, visitors: all.slice(0, limit) };
}

/** The daily report for the sheet: per day, visitors, page views, visitors by source, views by page. */
export async function exportVisits(actor: Actor, r: VisitRange): Promise<VisitReportDay[]> {
  requirePermission(actor, "sales:export");
  const w = where(r);
  let days: Row[], sources: Row[], pages: Row[];
  try {
    [days, sources, pages] = await Promise.all([
      query(`SELECT ${DAY} AS day, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM shop_visits WHERE ${w.sql} GROUP BY day ORDER BY day`, w.params),
      query(
        `SELECT DATE_FORMAT(v.day, '%Y-%m-%d') AS day, v.source, COUNT(*) AS visitors FROM shop_visits v
         JOIN (SELECT MIN(id) AS id FROM shop_visits WHERE ${w.sql} GROUP BY day, visitor) f ON f.id = v.id
         GROUP BY v.day, v.source`,
        w.params,
      ),
      query(`SELECT ${DAY} AS day, path, COUNT(*) AS views FROM shop_visits WHERE ${w.sql} GROUP BY day, path`, w.params),
    ]);
  } catch (e) {
    if (missingTable(e)) days = sources = pages = [];
    else throw e;
  }
  const out = new Map<string, VisitReportDay>(
    days.map((d) => [String(d.day), { day: String(d.day), visitors: num(d.visitors), pageViews: num(d.views), sources: {}, pages: {} }]),
  );
  sources.forEach((s) => {
    const d = out.get(String(s.day));
    if (d) d.sources[String(s.source)] = num(s.visitors);
  });
  pages.forEach((p) => {
    const d = out.get(String(p.day));
    if (d) d.pages[String(p.path)] = num(p.views);
  });
  const list = [...out.values()];
  await recordAudit(actor, { action: "sales.visits_exported", entityType: "visit", after: { days: list.length, from: r.from || null, to: r.to || null } });
  return list;
}
