import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * PaymentLinksService — Admin > Payment links.
 *
 * Staff fill in the website's checkout form for a buyer; the website (club-joia-300-next
 * app/api/staff, called with SHOP_ADMIN_KEY) books the order in its shop_orders with who made it
 * (created_by = users.id) and gives the link /shop/link/<ref>, payable for 1 to 5 days, with an optional fixed discount, and can
 * email it to the buyer. After payment the order is fulfilled as any website order (member,
 * tickets, confirmation email).
 * Sales viewers see and cancel only their own links; backoffice, admins and super admins all of them.
 */

export type LinkCatalog = {
  currency: string;
  maxPerTicket: number;
  tickets: { id: string; name: string; price: number; soldOut: boolean }[];
  countries: { code: string; name: string; dial: string }[];
};

export type LinkBuyer = {
  firstName: string;
  lastName: string;
  email: string;
  address: string;
  zipcode: string;
  city: string;
  country: string;
  gender: string;
  birthday: string;
  phoneCode: string;
  phone: string;
  over21: boolean;
  terms: boolean;
};

function seesAll(actor: Actor): boolean {
  return actor.role === "SUPER_ADMIN" || actor.role === "ADMIN" || actor.role === "BACKOFFICE";
}

function site(): { url: string; key: string } {
  const e = env();
  const url = (e.SHOP_API_URL ?? "").trim().replace(/\/+$/, "");
  const key = (e.SHOP_ADMIN_KEY ?? "").trim();
  if (!url || !key) throw new AppError("NOT_CONFIGURED", "Payment links aren't set up yet (SHOP_API_URL and SHOP_ADMIN_KEY).");
  return { url, key };
}

/** The link the buyer gets. */
export function paymentLinkUrl(ref: string): string {
  return site().url + "/shop/link/" + encodeURIComponent(ref);
}

/** Whether payment links are set up (the website's address and key). */
export function paymentLinksConfigured(): boolean {
  const e = env();
  return Boolean((e.SHOP_API_URL ?? "").trim() && (e.SHOP_ADMIN_KEY ?? "").trim());
}

// one call of the website's app/api/staff
/** One call to the website's staff API (app/api/staff) with SHOP_ADMIN_KEY; its { error } becomes an AppError. */
export async function shopApi<T>(action: string, body: unknown): Promise<T> {
  return call<T>(action, body);
}

async function call<T>(action: string, body: unknown): Promise<T> {
  const { url, key } = site();
  let res: Response;
  try {
    res = await fetch(url + "/api/staff/" + action, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[payment-links] website unreachable:", (e as Error).message);
    throw new AppError("INVALID_STATE", "The website can't be reached right now. Please try again in a moment.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 400 && data?.error) throw new AppError("VALIDATION", data.error);
  if (!res.ok || !data) {
    console.error(`[payment-links] website answered ${res.status} to ${action}:`, data?.error ?? "");
    if (res.status === 401) throw new AppError("NOT_CONFIGURED", "The website refused the key: SHOP_ADMIN_KEY must be the same as the website's.");
    throw new AppError("INVALID_STATE", data?.error ?? "The website couldn't do that right now. Please try again in a moment.");
  }
  return data;
}

let catalogCache: { at: number; value: LinkCatalog } | null = null;

/** The tickets on sale with their prices, and the countries, for the form (kept a minute). */
export async function linkCatalog(actor: Actor): Promise<LinkCatalog> {
  requirePermission(actor, "sales:links");
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.value;
  const value = await call<LinkCatalog>("catalog", {});
  catalogCache = { at: Date.now(), value };
  return value;
}

export const LINK_DAYS = [1, 2, 3, 4, 5] as const;

export async function createPaymentLink(
  actor: Actor,
  buyer: LinkBuyer,
  items: { id: string; quantity: number }[],
  options: { linkDays: (typeof LINK_DAYS)[number]; sendEmail: boolean; discount?: number } = { linkDays: 1, sendEmail: false },
) {
  requirePermission(actor, "sales:links");
  if (!items.length) throw new AppError("VALIDATION", "Choose at least one ticket.");
  const discount = options.discount && options.discount > 0 ? options.discount : 0;
  const made = await call<{ ref: string; url: string; amount: number; discount?: number; currency: string; expiresAt: string; emailed: boolean }>("order", {
    createdBy: actor.userId,
    buyer,
    items,
    linkDays: options.linkDays,
    discount,
    sendEmail: options.sendEmail,
  });
  await recordAudit(actor, {
    action: "sales.payment_link_created",
    entityType: "shop_order",
    entityId: made.ref,
    // who made it is the audit's actor; the discount they gave is kept with the link
    after: { email: buyer.email, items, amount: made.amount, discount: made.discount ?? discount, currency: made.currency, linkDays: options.linkDays, emailed: made.emailed },
  });
  return made;
}

export type PaymentLinkRow = {
  ref: string;
  createdAt: Date;
  buyerName: string;
  email: string;
  items: { name: string; quantity: number }[];
  amount: number;
  /** the fixed amount off the tickets (0 = none); amount is after it */
  discount: number;
  currency: string;
  state: "paid" | "unpaid" | "cancelled" | "expired";
  expiresAt: Date | null;
  paidRef: string | null;
  createdBy: string;
  url: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function missing(e: unknown): boolean {
  return /doesn't exist|1146|Unknown column|1054/i.test(String((e as Error)?.message ?? e));
}

function parse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

// the website adds shop_orders.discount (club-joia-300-next lib/shop/db.ts) on its first start after the update
let discountColumn = false;
export async function hasDiscount(): Promise<boolean> {
  if (discountColumn) return true;
  const rows = await db.$queryRawUnsafe<Row[]>(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'shop_orders' AND column_name = 'discount' LIMIT 1",
  );
  discountColumn = rows.length > 0;
  return discountColumn;
}

/** Payment links, newest first, a page at a time: the actor's own, or all for admins. */
export async function listPaymentLinks(actor: Actor, page = 1, pageSize = 25): Promise<{ available: boolean; total: number; page: number; links: PaymentLinkRow[]; all: boolean }> {
  requirePermission(actor, "sales:links");
  const all = seesAll(actor);
  const where = "o.created_by IS NOT NULL AND o.retry_of IS NULL" + (all ? "" : " AND o.created_by = ?");
  const params: unknown[] = all ? [] : [actor.userId];
  let total = 0;
  let rows: Row[] = [];
  try {
    const withDiscount = await hasDiscount();
    const t = await db.$queryRawUnsafe<Row[]>(`SELECT COUNT(*) AS n FROM shop_orders o WHERE ${where}`, ...params);
    total = Number(String(t[0]?.n ?? 0));
    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    rows = await db.$queryRawUnsafe<Row[]>(
      `SELECT o.ref, o.created_at, o.buyer, o.email, o.items, o.amount${withDiscount ? ", o.discount" : ""}, o.currency, o.staff_cancelled_at, o.link_expires_at,
         (o.link_expires_at IS NOT NULL AND o.link_expires_at <= UTC_TIMESTAMP(3)) AS expired, u.name AS made_by,
         (SELECT p.ref FROM shop_orders p WHERE (p.ref = o.ref OR p.retry_of = o.ref) AND p.status = 'paid' LIMIT 1) AS paid_ref
       FROM shop_orders o LEFT JOIN users u ON u.id = o.created_by
       WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );
  } catch (e) {
    if (missing(e)) return { available: false, total: 0, page: 1, links: [], all };
    throw e;
  }
  const base = (env().SHOP_API_URL ?? "").trim().replace(/\/+$/, "");
  return {
    available: true,
    total,
    page,
    all,
    links: rows.map((r) => {
      const buyer = parse<{ firstName?: string; lastName?: string }>(r.buyer, {});
      return {
        ref: String(r.ref),
        createdAt: new Date(r.created_at),
        buyerName: [buyer.firstName, buyer.lastName].filter(Boolean).join(" "),
        email: String(r.email),
        items: parse<{ name: string; quantity: number }[]>(r.items, []).map((i) => ({ name: String(i.name), quantity: Number(i.quantity) })),
        amount: Number(String(r.amount)),
        discount: r.discount == null ? 0 : Number(String(r.discount)),
        currency: String(r.currency),
        state: r.paid_ref ? "paid" : r.staff_cancelled_at ? "cancelled" : Number(String(r.expired)) ? "expired" : "unpaid",
        expiresAt: r.link_expires_at ? new Date(r.link_expires_at) : null,
        paidRef: r.paid_ref ? String(r.paid_ref) : null,
        createdBy: r.made_by ? String(r.made_by) : "—",
        url: base ? base + "/shop/link/" + encodeURIComponent(String(r.ref)) : "",
      };
    }),
  };
}

/** Cancels an unpaid payment link (the actor's own, or any for admins). */
export async function cancelPaymentLink(actor: Actor, ref: string) {
  requirePermission(actor, "sales:links");
  const rows = await db.$queryRawUnsafe<Row[]>("SELECT ref, created_by FROM shop_orders WHERE ref = ? AND created_by IS NOT NULL AND retry_of IS NULL", ref);
  const o = rows[0];
  if (!o || (!seesAll(actor) && o.created_by !== actor.userId)) throw new AppError("NOT_FOUND", "Payment link not found.");
  const { result } = await call<{ result: string }>("cancel", { ref });
  if (result === "paid") throw new AppError("INVALID_STATE", "This link has been paid already, so it can't be cancelled.");
  if (result === "busy") throw new AppError("INVALID_STATE", "The buyer is paying right now. Please try again in a few minutes.");
  if (result !== "cancelled") throw new AppError("NOT_FOUND", "Payment link not found.");
  await recordAudit(actor, { action: "sales.payment_link_cancelled", entityType: "shop_order", entityId: ref });
}
