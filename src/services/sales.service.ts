import "server-only";
import { db } from "@/lib/db";
import { ORDER_STATUSES, SALES_TIMEZONE, isDay, type SalesFilters } from "@/lib/sales/filters";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * SalesService — the website's ticket sales and pre-registrations, read only, for /admin/sales.
 *
 * The website (club-joia-300-next) keeps its orders in `shop_orders` and its pre-registrations in
 * `pre_registrations`, in this same database. They are its own tables (made by its lib/shop/db.ts),
 * not in the Prisma schema, so they are read with raw SQL here. When the website hasn't made them
 * yet (a fresh database), every figure is empty and `available` is false.
 *
 * Days are counted in SHOP_TIMEZONE (Asia/Dubai); amounts in the orders' currency (SHOP_CURRENCY).
 */

const CURRENCY = (process.env.SHOP_CURRENCY || "AED").toUpperCase();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function num(v: unknown): number {
  return Number(typeof v === "bigint" ? v.toString() : v === null || v === undefined ? 0 : String(v)) || 0;
}

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

/** A missing website table (the website hasn't run on this database yet). */
function missingTable(e: unknown): boolean {
  return /doesn't exist|1146|no such table/i.test(String((e as Error)?.message ?? e));
}

async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  return db.$queryRawUnsafe<Row[]>(sql, ...params);
}

/** A moment as MySQL DATETIME text in UTC (the sessions are UTC, src/lib/db-adapter.ts). */
function sqlTime(at: Date): string {
  return at.toISOString().replace("T", " ").replace("Z", "");
}

/** Minutes the time zone is ahead of UTC at that moment. */
function zoneOffset(at: Date, timeZone: string): number {
  const p: Record<string, number> = {};
  new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at)
    .forEach((x) => {
      if (x.type !== "literal") p[x.type] = Number(x.value);
    });
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The moment a day (YYYY-MM-DD) starts in the shop's time zone, plus some days. */
export function dayStart(day: string, plusDays = 0, timeZone = SALES_TIMEZONE): Date {
  const utc = new Date(day + "T00:00:00Z");
  utc.setUTCDate(utc.getUTCDate() + plusDays);
  const at = new Date(utc.getTime() - zoneOffset(utc, timeZone) * 60000);
  return new Date(utc.getTime() - zoneOffset(at, timeZone) * 60000); // across a clock change
}

/** The day (YYYY-MM-DD) of a moment in the shop's time zone. */
function dayOf(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SALES_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** "united arab emirates" → "United Arab Emirates", as countries are grouped. */
function initcap(s: string): string {
  return String(s || "").toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

// the items of an order o as rows i
const ITEMS =
  "JSON_TABLE(o.items, '$[*]' COLUMNS (product_id VARCHAR(100) PATH '$.productId', name VARCHAR(200) PATH '$.name', tier VARCHAR(50) PATH '$.tier', " +
  "quantity INT PATH '$.quantity', price DECIMAL(12,2) PATH '$.price', codes JSON PATH '$.codes')) i";

export type SalesFilterInput = Pick<SalesFilters, "from" | "to" | "status" | "product" | "tier" | "country" | "q">;

/** SQL conditions on shop_orders o for the filters, and on an item i of it (ticket, tier). */
function where(f: SalesFilterInput) {
  const params: unknown[] = [];
  const conds = ["1 = 1"];
  const items: string[] = [];
  const itemParams: unknown[] = [];
  if (isDay(f.from)) {
    conds.push("o.created_at >= ?");
    params.push(sqlTime(dayStart(f.from)));
  }
  if (isDay(f.to)) {
    conds.push("o.created_at < ?");
    params.push(sqlTime(dayStart(f.to, 1)));
  }
  if ((ORDER_STATUSES as readonly string[]).includes(f.status)) {
    conds.push("o.status = ?");
    params.push(f.status);
  }
  if (f.product) {
    conds.push("JSON_CONTAINS(o.items, ?)");
    params.push(JSON.stringify([{ productId: f.product }]));
    items.push("i.product_id = ?");
    itemParams.push(f.product);
  }
  if (f.tier) {
    conds.push("JSON_CONTAINS(o.items, ?)");
    params.push(JSON.stringify([{ tier: f.tier }]));
    items.push("i.tier = ?");
    itemParams.push(f.tier);
  }
  // JSON text compares case-sensitively: both sides lower case
  if (f.country) {
    conds.push("LOWER(o.buyer->>'$.country') = LOWER(?)");
    params.push(f.country);
  }
  const q = f.q.trim().slice(0, 100);
  if (q) {
    const like = "%" + q.toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    conds.push(
      "(LOWER(o.ref) LIKE ? OR o.email LIKE ? OR LOWER(CONCAT(o.buyer->>'$.firstName', ' ', o.buyer->>'$.lastName')) LIKE ? OR o.buyer->>'$.mobile' LIKE ?)",
    );
    params.push(like, like, like, like);
  }
  return { sql: "WHERE " + conds.join(" AND "), params, items: items.length ? " AND " + items.join(" AND ") : "", itemParams };
}

export type SalesTotals = { revenue: number; orders: number; paid: number; buyers: number; tickets: number; average: number };
export type SalesStats = {
  available: boolean;
  currency: string;
  totals: SalesTotals;
  byStatus: { status: string; orders: number; amount: number }[];
  byDay: { day: string; revenue: number; paid: number; orders: number }[];
  byProduct: { id: string; name: string; tier: string; price: number; tickets: number; revenue: number }[];
  byTier: { tier: string; name: string; theme: string; tickets: number; revenue: number }[];
  byCountry: { country: string; orders: number; revenue: number }[];
  byTicketType: { code: string; name: string; tickets: number }[];
  options: { products: { id: string; name: string }[]; tiers: { id: string; name: string }[]; countries: string[] };
};

function emptyStats(available: boolean, tiers: { slug: string; displayName: string; cardTheme: string }[] = []): SalesStats {
  return {
    available,
    currency: CURRENCY,
    totals: { revenue: 0, orders: 0, paid: 0, buyers: 0, tickets: 0, average: 0 },
    byStatus: ORDER_STATUSES.map((status) => ({ status, orders: 0, amount: 0 })),
    byDay: [],
    byProduct: [],
    byTier: tiers.map((t) => ({ tier: t.slug, name: t.displayName, theme: t.cardTheme, tickets: 0, revenue: 0 })),
    byCountry: [],
    byTicketType: [],
    options: { products: [], tiers: tiers.map((t) => ({ id: t.slug, name: t.displayName })), countries: [] },
  };
}

/** Figures and chart data of the orders matching the filters (revenue, tickets, buyers: paid orders only). */
export async function getSalesStats(actor: Actor, f: SalesFilterInput): Promise<SalesStats> {
  requirePermission(actor, "sales:view");
  const tiers = await db.membershipTier.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, displayName: true, cardTheme: true } });
  const w = where(f);
  const paidItems = `FROM shop_orders o, ${ITEMS} ${w.sql} AND o.status = 'paid'${w.items}`;
  const paidParams = [...w.params, ...w.itemParams];

  let rows: Row[][];
  try {
    rows = await Promise.all([
      query(
        `SELECT COUNT(*) AS orders, SUM(o.status = 'paid') AS paid, COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.amount END), 0) AS revenue,
           COUNT(DISTINCT CASE WHEN o.status = 'paid' THEN o.email END) AS buyers
         FROM shop_orders o ${w.sql}`,
        w.params,
      ),
      query(`SELECT COALESCE(SUM(i.quantity), 0) AS tickets ${paidItems}`, paidParams),
      // per day in the shop's time zone, counted below (the server may have no time zone tables)
      query(`SELECT o.created_at, o.status, o.amount FROM shop_orders o ${w.sql}`, w.params),
      query(`SELECT i.product_id AS id, SUM(i.quantity) AS tickets, SUM(i.quantity * i.price) AS revenue ${paidItems} GROUP BY i.product_id`, paidParams),
      query(`SELECT i.tier AS tier, SUM(i.quantity) AS tickets, SUM(i.quantity * i.price) AS revenue ${paidItems} GROUP BY i.tier`, paidParams),
      query(`SELECT o.status, COUNT(*) AS orders, COALESCE(SUM(o.amount), 0) AS amount FROM shop_orders o ${w.sql} GROUP BY o.status`, w.params),
      query(
        `SELECT LOWER(o.buyer->>'$.country') AS country, COUNT(*) AS orders, SUM(o.amount) AS revenue
         FROM shop_orders o ${w.sql} AND o.status = 'paid' GROUP BY 1`,
        w.params,
      ),
      query(
        `SELECT c.code, SUM(i.quantity) AS tickets
         FROM shop_orders o, ${ITEMS}, JSON_TABLE(i.codes, '$[*]' COLUMNS (code VARCHAR(20) PATH '$')) c
         ${w.sql} AND o.status = 'paid'${w.items} GROUP BY c.code`,
        paidParams,
      ),
      // every ticket ever ordered (its latest name and price), for the filter and the table
      query(
        `SELECT i.product_id AS id, MAX(i.name) AS name, MAX(i.tier) AS tier, MAX(i.price) AS price
         FROM shop_orders o, ${ITEMS} WHERE i.product_id IS NOT NULL GROUP BY i.product_id`,
      ),
      query("SELECT DISTINCT LOWER(buyer->>'$.country') AS country FROM shop_orders WHERE buyer->>'$.country' <> ''"),
    ]);
  } catch (e) {
    if (missingTable(e)) return emptyStats(false, tiers);
    throw e;
  }
  const [totals, tickets, days, byProduct, byTier, byStatus, countryRows, byType, products, countryList] = rows;

  const perDay = new Map<string, { day: string; revenue: number; paid: number; orders: number }>();
  for (const o of days) {
    const day = dayOf(new Date(o.created_at));
    const d = perDay.get(day) ?? { day, revenue: 0, paid: 0, orders: 0 };
    d.orders++;
    if (o.status === "paid") {
      d.paid++;
      d.revenue = Math.round((d.revenue + num(o.amount)) * 100) / 100;
    }
    perDay.set(day, d);
  }

  const typeNames = new Map<string, string>();
  if (byType.length) {
    // the newest ticket type of each code names it
    const types = await db.ticketType.findMany({ where: { code: { in: byType.map((t) => String(t.code)) } }, orderBy: { createdAt: "asc" }, select: { code: true, name: true } });
    for (const t of types) typeNames.set(t.code, t.name);
  }

  const t = totals[0] ?? {};
  const paid = num(t.paid);
  const revenue = num(t.revenue);
  const statusOf = new Map(byStatus.map((s) => [String(s.status), { orders: num(s.orders), amount: num(s.amount) }]));
  const productOf = new Map(byProduct.map((p) => [String(p.id), p]));
  const tierOf = new Map(byTier.map((p) => [String(p.tier), p]));
  const productList = products
    .map((p) => ({ id: String(p.id), name: String(p.name ?? p.id), tier: String(p.tier ?? ""), price: num(p.price) }))
    .sort((a, b) => {
      const ta = tiers.findIndex((x) => x.slug === a.tier);
      const tb = tiers.findIndex((x) => x.slug === b.tier);
      return ta - tb || b.price - a.price || (a.name < b.name ? -1 : 1);
    });

  return {
    available: true,
    currency: CURRENCY,
    totals: { revenue, orders: num(t.orders), paid, buyers: num(t.buyers), tickets: num(tickets[0]?.tickets), average: paid ? Math.round((revenue / paid) * 100) / 100 : 0 },
    byStatus: ORDER_STATUSES.map((s) => ({ status: s, orders: statusOf.get(s)?.orders ?? 0, amount: statusOf.get(s)?.amount ?? 0 })),
    byDay: [...perDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    byProduct: productList.map((p) => ({ ...p, tickets: num(productOf.get(p.id)?.tickets), revenue: num(productOf.get(p.id)?.revenue) })),
    byTier: tiers.map((x) => ({ tier: x.slug, name: x.displayName, theme: x.cardTheme, tickets: num(tierOf.get(x.slug)?.tickets), revenue: num(tierOf.get(x.slug)?.revenue) })),
    byCountry: countryRows
      .map((c) => ({ country: initcap(String(c.country ?? "")), orders: num(c.orders), revenue: num(c.revenue) }))
      .sort((a, b) => b.revenue - a.revenue || (a.country < b.country ? -1 : 1)),
    byTicketType: byType.map((x) => ({ code: String(x.code), name: typeNames.get(String(x.code)) ?? String(x.code), tickets: num(x.tickets) })).sort((a, b) => b.tickets - a.tickets),
    options: {
      products: productList.map((p) => ({ id: p.id, name: p.name })),
      tiers: tiers.map((x) => ({ id: x.slug, name: x.displayName })),
      countries: [...new Set(countryList.map((c) => initcap(String(c.country ?? ""))))].filter(Boolean).sort(),
    },
  };
}

export type SalesOrderItem = { productId: string; name: string; quantity: number; price: number; tier?: string; codes?: string[] };
export type SalesBuyer = { name: string; email: string; mobile: string; country: string; address?: string; zipcode?: string; city?: string; gender?: string; birthday?: string };
export type SalesOrderRow = {
  ref: string;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  buyer: SalesBuyer;
  items: SalesOrderItem[];
  amount: number;
  currency: string;
  tickets: number;
  error: string | null;
};

function orderRow(o: Row): SalesOrderRow {
  const buyer = json<Record<string, string>>(o.buyer, {});
  const items = json<SalesOrderItem[]>(o.items, []);
  return {
    ref: String(o.ref),
    status: String(o.status),
    createdAt: new Date(o.created_at),
    paidAt: o.paid_at ? new Date(o.paid_at) : null,
    buyer: { name: ((buyer.firstName || "") + " " + (buyer.lastName || "")).trim(), email: buyer.email || String(o.email || ""), mobile: buyer.mobile || "", country: buyer.country || "" },
    items: items.map((i) => ({ productId: i.productId, name: i.name, quantity: num(i.quantity), price: num(i.price), tier: i.tier, codes: i.codes })),
    amount: num(o.amount),
    currency: String(o.currency || CURRENCY),
    tickets: json<string[]>(o.tickets, []).length,
    error: o.error ? String(o.error) : null,
  };
}

const LIST_COLUMNS = "o.ref, o.status, o.email, o.buyer, o.items, o.amount, o.currency, o.tickets, o.error, o.created_at, o.paid_at";

/** The orders matching the filters, newest first (up to 10,000 a page, for the CSV). */
export async function listSalesOrders(actor: Actor, f: SalesFilterInput, page = 1, perPage = 25): Promise<{ total: number; page: number; perPage: number; orders: SalesOrderRow[] }> {
  requirePermission(actor, "sales:view");
  const size = Math.min(Math.max(Math.floor(perPage) || 25, 1), 10000);
  const p = Math.max(Math.floor(page) || 1, 1);
  const w = where(f);
  try {
    const [count, rows] = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM shop_orders o ${w.sql}`, w.params),
      query(`SELECT ${LIST_COLUMNS} FROM shop_orders o ${w.sql} ORDER BY o.created_at DESC, o.id DESC LIMIT ${size} OFFSET ${(p - 1) * size}`, w.params),
    ]);
    return { total: num(count[0]?.n), page: p, perPage: size, orders: rows.map(orderRow) };
  } catch (e) {
    if (missingTable(e)) return { total: 0, page: p, perPage: size, orders: [] };
    throw e;
  }
}

export type SalesOrderDetail = SalesOrderRow & {
  buyer: SalesBuyer;
  fulfilledAt: Date | null;
  updatedAt: Date;
  payment: { id: string | null; status: string | null };
  member: { id: string; number: string; email: string; account: string; tier: string | null; membership: string | null } | null;
  ticketList: { number: string; code: string; name: string; status: string }[];
};

/** One order: buyer, tickets bought and issued, payment and the member it made. */
export async function getSalesOrder(actor: Actor, ref: string): Promise<SalesOrderDetail | null> {
  requirePermission(actor, "sales:view");
  let o: Row | undefined;
  try {
    o = (await query(`SELECT ${LIST_COLUMNS}, o.member_id, o.pay_id, o.pay_status, o.fulfilled_at, o.updated_at FROM shop_orders o WHERE o.ref = ?`, [ref.slice(0, 64)]))[0];
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
  if (!o) return null;
  const row = orderRow(o);
  const buyer = json<Record<string, string>>(o.buyer, {});
  const numbers = json<string[]>(o.tickets, []).filter((x) => typeof x === "string");

  const [member, tickets] = await Promise.all([
    o.member_id
      ? db.member.findUnique({
          where: { id: String(o.member_id) },
          select: {
            id: true,
            membershipNumber: true,
            user: { select: { email: true, status: true } },
            memberships: { orderBy: { issueDate: "desc" }, take: 1, select: { status: true, tier: { select: { displayName: true } } } },
          },
        })
      : null,
    numbers.length
      ? db.ticket.findMany({
          where: { ticketNumber: { in: numbers } },
          orderBy: [{ createdAt: "asc" }, { ticketNumber: "asc" }],
          select: { ticketNumber: true, status: true, ticketType: { select: { code: true, name: true } } },
        })
      : [],
  ]);

  return {
    ...row,
    buyer: {
      ...row.buyer,
      address: buyer.address || "",
      zipcode: buyer.zipcode || "",
      city: buyer.city || "",
      gender: buyer.gender || "",
      birthday: buyer.birthday || "",
    },
    fulfilledAt: o.fulfilled_at ? new Date(o.fulfilled_at) : null,
    updatedAt: new Date(o.updated_at),
    payment: { id: o.pay_id ? String(o.pay_id) : null, status: o.pay_status ? String(o.pay_status) : null },
    member: member
      ? {
          id: member.id,
          number: member.membershipNumber,
          email: member.user.email,
          account: member.user.status,
          tier: member.memberships[0]?.tier.displayName ?? null,
          membership: member.memberships[0]?.status ?? null,
        }
      : null,
    ticketList: tickets.map((t) => ({ number: t.ticketNumber, code: t.ticketType.code, name: t.ticketType.name, status: t.status })),
  };
}

export type PreRegistration = {
  createdAt: Date;
  updatedAt: Date;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  tier: string;
  source: string;
  message: string;
  marketing: boolean;
};

/** The website's pre-registrations, newest first (up to 10,000), with q searching name, email, phone, country. */
export async function listPreRegistrations(actor: Actor, q = ""): Promise<{ available: boolean; total: number; byTier: Record<string, number>; registrations: PreRegistration[] }> {
  requirePermission(actor, "sales:view");
  const s = q.trim().slice(0, 100);
  const like = s ? "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
  // the columns ignore case (utf8mb4_unicode_ci)
  const filter = like ? "WHERE email LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ? OR phone LIKE ? OR country LIKE ?" : "";
  try {
    const [rows, tiers] = await Promise.all([
      query(`SELECT * FROM pre_registrations ${filter} ORDER BY created_at DESC, id DESC LIMIT 10000`, like ? [like, like, like, like] : []),
      query("SELECT tier_interest AS tier, COUNT(*) AS n FROM pre_registrations GROUP BY tier_interest"),
    ]);
    return {
      available: true,
      total: tiers.reduce((n, t) => n + num(t.n), 0),
      byTier: Object.fromEntries(tiers.map((t) => [String(t.tier), num(t.n)])),
      registrations: rows.map((r) => ({
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at),
        firstName: String(r.first_name ?? ""),
        lastName: String(r.last_name ?? ""),
        email: String(r.email ?? ""),
        phone: String(r.phone ?? ""),
        country: String(r.country ?? ""),
        tier: String(r.tier_interest ?? ""),
        source: String(r.source ?? ""),
        message: String(r.message ?? ""),
        marketing: !!num(r.marketing_opt_in),
      })),
    };
  } catch (e) {
    if (missingTable(e)) return { available: false, total: 0, byTier: {}, registrations: [] };
    throw e;
  }
}


/** The orders matching the filters for a CSV download (up to 10,000), noted in the audit log: it holds buyers' details. */
export async function exportSalesOrders(actor: Actor, f: SalesFilterInput): Promise<SalesOrderRow[]> {
  const list = await listSalesOrders(actor, f, 1, 10000);
  await recordAudit(actor, { action: "sales.orders_exported", entityType: "shop_order", after: { rows: list.orders.length, filters: f } });
  return list.orders;
}

/** The pre-registrations for a CSV download, noted in the audit log. */
export async function exportPreRegistrations(actor: Actor, q = ""): Promise<PreRegistration[]> {
  const data = await listPreRegistrations(actor, q);
  await recordAudit(actor, { action: "sales.registrations_exported", entityType: "pre_registration", after: { rows: data.registrations.length, q: q || null } });
  return data.registrations;
}
