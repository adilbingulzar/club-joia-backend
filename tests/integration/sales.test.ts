import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/services/context";
import { exportPreRegistrations, exportSalesOrders, getSalesOrder, getSalesStats, listPreRegistrations, listSalesOrders } from "@/services/sales.service";
import { actorFor, EMAILS, ticketOf } from "../support/actors";

/**
 * The website's sales on this database (src/services/sales.service.ts): its own tables
 * (shop_orders, pre_registrations) are made here as the website makes them (its lib/shop/db.ts),
 * filled with a few orders, and read back through the service.
 */

const NO_FILTER = { from: "", to: "", status: "", product: "", tier: "", country: "", q: "" };

// the website's tables, as its lib/shop/db.ts makes them (the columns the dashboard reads)
const SHOP_ORDERS = `CREATE TABLE IF NOT EXISTS shop_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ref VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
  event_id VARCHAR(191) NOT NULL, email VARCHAR(191) NOT NULL, ip VARCHAR(64) NOT NULL DEFAULT '', buyer JSON NOT NULL, items JSON NOT NULL,
  amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL, pay_id VARCHAR(191) NULL, pay_status VARCHAR(20) NULL, member_id VARCHAR(191) NULL,
  tickets JSON NULL, error TEXT NULL, retry_of VARCHAR(64) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), paid_at DATETIME(3) NULL, fulfilled_at DATETIME(3) NULL, UNIQUE KEY orders_ref (ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const PRE_REGISTRATIONS = `CREATE TABLE IF NOT EXISTS pre_registrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, email VARCHAR(191) NOT NULL, first_name VARCHAR(80) NOT NULL, last_name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL, country VARCHAR(80) NOT NULL, tier_interest VARCHAR(20) NOT NULL, source VARCHAR(120) NULL, message TEXT NULL,
  marketing_opt_in TINYINT(1) NOT NULL DEFAULT 0, consent_at DATETIME(3) NOT NULL, ip_hash CHAR(64) NULL, user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const RUBY_3 = { productId: "ruby-red/3-days", name: "Ruby Red, 3 days", price: 8000, tier: "ruby-red", codes: ["FRI", "SAT", "SUN", "AFTER"] };
const PEARL_FS = { productId: "pearly-white/fri-sat", name: "Pearly White, Friday & Saturday", price: 5000, tier: "pearly-white", codes: ["FRI", "SAT"] };

async function addOrder(o: { ref: string; status: string; at: string; email: string; country: string; items: (typeof RUBY_3 & { quantity: number })[]; memberId?: string; tickets?: string[]; payId?: string; error?: string }) {
  const amount = o.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const buyer = { firstName: "Test", lastName: o.ref, email: o.email, mobile: "+971 50 000 " + o.ref.slice(-4), country: o.country, address: "Street 1", zipcode: "00000", city: "Dubai" };
  await db.$executeRawUnsafe(
    "INSERT INTO shop_orders (ref, status, event_id, email, buyer, items, amount, currency, member_id, tickets, pay_id, pay_status, error, created_at, paid_at) VALUES (?, ?, 'cj300', ?, ?, ?, ?, 'AED', ?, ?, ?, ?, ?, ?, ?)",
    o.ref, o.status, o.email, JSON.stringify(buyer), JSON.stringify(o.items), amount, o.memberId ?? null, o.tickets ? JSON.stringify(o.tickets) : null,
    o.payId ?? null, o.payId ? (o.status === "paid" ? "PAID" : "DECLINED") : null, o.error ?? null, o.at, o.status === "paid" ? o.at : null,
  );
}

let admin: Actor;
let manager: Actor;
let concierge: Actor;
let alexTicket: string;
let alexMember: string;

beforeAll(async () => {
  [admin, manager, concierge] = await Promise.all([actorFor(EMAILS.admin), actorFor(EMAILS.manager), actorFor(EMAILS.concierge)]);
  const t = await ticketOf(EMAILS.alex, "FRI");
  alexTicket = t.ticketNumber;
  alexMember = t.memberId;
});

afterAll(async () => {
  await db.$executeRawUnsafe("DROP TABLE IF EXISTS shop_orders");
  await db.$executeRawUnsafe("DROP TABLE IF EXISTS pre_registrations");
});

describe("sales before the website made its tables", () => {
  it("shows nothing, and says why", async () => {
    await db.$executeRawUnsafe("DROP TABLE IF EXISTS shop_orders");
    await db.$executeRawUnsafe("DROP TABLE IF EXISTS pre_registrations");
    const stats = await getSalesStats(admin, NO_FILTER);
    expect(stats).toMatchObject({ available: false, totals: { revenue: 0, orders: 0 } });
    expect(stats.byTier.map((t) => t.tier)).toEqual(["ruby-red", "pearly-white", "ultra-black"]);
    expect(await listSalesOrders(admin, NO_FILTER)).toMatchObject({ total: 0, orders: [] });
    expect(await getSalesOrder(admin, "CJ-NOPE")).toBeNull();
    expect(await listPreRegistrations(admin)).toMatchObject({ available: false, total: 0 });
  });
});

describe("sales on the website's orders", () => {
  beforeAll(async () => {
    await db.$executeRawUnsafe(SHOP_ORDERS);
    await db.$executeRawUnsafe(PRE_REGISTRATIONS);
    // 9 Nov 21:30 UTC is 10 Nov in Dubai
    await addOrder({ ref: "CJ-T-0001", status: "paid", at: "2026-11-09 21:30:00", email: "one@sales.test", country: "united arab emirates", items: [{ ...RUBY_3, quantity: 2 }], memberId: alexMember, tickets: [alexTicket], payId: "pay_one" });
    await addOrder({ ref: "CJ-T-0002", status: "paid", at: "2026-11-08 08:00:00", email: "two@sales.test", country: "Pakistan", items: [{ ...PEARL_FS, quantity: 1 }, { ...RUBY_3, quantity: 1 }] });
    await addOrder({ ref: "CJ-T-0003", status: "declined", at: "2026-11-08 09:00:00", email: "two@sales.test", country: "Pakistan", items: [{ ...PEARL_FS, quantity: 3 }], payId: "pay_three", error: "card refused" });
    await addOrder({ ref: "CJ-T-0004", status: "pending", at: "2026-11-01 09:00:00", email: "four@sales.test", country: "United Arab Emirates", items: [{ ...RUBY_3, quantity: 1 }] });
    await db.$executeRawUnsafe(
      "INSERT INTO pre_registrations (email, first_name, last_name, phone, country, tier_interest, source, message, marketing_opt_in, consent_at, created_at, updated_at) VALUES " +
        "('sara@pre.test', 'Sara', 'Khan', '+971501', 'UAE', 'Ruby Red', 'Instagram', 'hi', 1, NOW(3), '2026-11-02 10:00:00', '2026-11-02 10:00:00'), " +
        "('omar@pre.test', 'Omar', 'Ali', '+92300', 'Pakistan', 'Ultra Black', NULL, NULL, 0, NOW(3), '2026-11-03 10:00:00', '2026-11-03 10:00:00')",
    );
  });

  it("counts revenue, tickets and buyers from paid orders only", async () => {
    const s = await getSalesStats(admin, NO_FILTER);
    expect(s.available).toBe(true);
    expect(s.currency).toBe("AED");
    // paid: 2 × 8000 + (5000 + 8000)
    expect(s.totals).toEqual({ revenue: 29000, orders: 4, paid: 2, buyers: 2, tickets: 4, average: 14500 });
    expect(s.byStatus).toEqual([
      { status: "pending", orders: 1, amount: 8000 },
      { status: "paid", orders: 2, amount: 29000 },
      { status: "declined", orders: 1, amount: 15000 },
      { status: "cancelled", orders: 0, amount: 0 },
      { status: "failed", orders: 0, amount: 0 },
    ]);
    expect(s.byProduct.find((p) => p.id === "ruby-red/3-days")).toMatchObject({ name: "Ruby Red, 3 days", tickets: 3, revenue: 24000 });
    expect(s.byProduct.find((p) => p.id === "pearly-white/fri-sat")).toMatchObject({ tickets: 1, revenue: 5000 });
    expect(s.byTier).toEqual([
      { tier: "ruby-red", name: "Ruby Red", theme: "ruby", tickets: 3, revenue: 24000 },
      { tier: "pearly-white", name: "Pearly White", theme: "pearl", tickets: 1, revenue: 5000 },
      { tier: "ultra-black", name: "Ultra Black", theme: "black", tickets: 0, revenue: 0 },
    ]);
    // countries grouped whatever their case
    expect(s.byCountry).toEqual([
      { country: "United Arab Emirates", orders: 1, revenue: 16000 },
      { country: "Pakistan", orders: 1, revenue: 13000 },
    ]);
    expect(s.options.countries).toEqual(["Pakistan", "United Arab Emirates"]);
    // admissions: each ticket's codes, named by the members app's ticket types
    expect(s.byTicketType.find((x) => x.code === "FRI")).toEqual({ code: "FRI", name: "Friday Access", tickets: 4 });
    expect(s.byTicketType.find((x) => x.code === "AFTER")).toMatchObject({ tickets: 3 });
    // days in Dubai time
    expect(s.byDay).toEqual([
      { day: "2026-11-01", revenue: 0, paid: 0, orders: 1 },
      { day: "2026-11-08", revenue: 13000, paid: 1, orders: 2 },
      { day: "2026-11-10", revenue: 16000, paid: 1, orders: 1 },
    ]);
  });

  it("filters by Dubai days, status, ticket, tier, country and search", async () => {
    expect((await getSalesStats(admin, { ...NO_FILTER, from: "2026-11-10", to: "2026-11-10" })).totals).toMatchObject({ orders: 1, revenue: 16000 });
    expect((await getSalesStats(admin, { ...NO_FILTER, from: "2026-11-09", to: "2026-11-09" })).totals.orders).toBe(0);
    expect((await listSalesOrders(admin, { ...NO_FILTER, status: "declined" })).orders.map((o) => o.ref)).toEqual(["CJ-T-0003"]);
    // a ticket filter counts only that ticket's items
    const pearl = await getSalesStats(admin, { ...NO_FILTER, product: "pearly-white/fri-sat" });
    expect(pearl.totals).toMatchObject({ orders: 2, paid: 1, tickets: 1 });
    expect((await getSalesStats(admin, { ...NO_FILTER, tier: "ruby-red" })).totals.tickets).toBe(3);
    expect((await listSalesOrders(admin, { ...NO_FILTER, country: "UNITED ARAB EMIRATES" })).total).toBe(2);
    expect((await listSalesOrders(admin, { ...NO_FILTER, q: "two@SALES" })).total).toBe(2);
    expect((await listSalesOrders(admin, { ...NO_FILTER, q: "cj-t-0004" })).orders[0]).toMatchObject({ ref: "CJ-T-0004", buyer: { name: "Test CJ-T-0004" } });
    // a % in the search is a character, not a wildcard
    expect((await listSalesOrders(admin, { ...NO_FILTER, q: "%" })).total).toBe(0);
  });

  it("lists orders newest first, a page at a time", async () => {
    const page1 = await listSalesOrders(admin, NO_FILTER, 1, 3);
    expect(page1.total).toBe(4);
    expect(page1.orders.map((o) => o.ref)).toEqual(["CJ-T-0001", "CJ-T-0003", "CJ-T-0002"]);
    expect(page1.orders[0]).toMatchObject({ status: "paid", amount: 16000, currency: "AED", tickets: 1, items: [{ productId: "ruby-red/3-days", quantity: 2, price: 8000 }] });
    expect((await listSalesOrders(admin, NO_FILTER, 2, 3)).orders.map((o) => o.ref)).toEqual(["CJ-T-0004"]);
  });

  it("shows one order with its payment, member and tickets", async () => {
    const o = await getSalesOrder(manager, "CJ-T-0001");
    expect(o).toMatchObject({ ref: "CJ-T-0001", status: "paid", payment: { id: "pay_one", status: "PAID" }, buyer: { address: "Street 1", city: "Dubai" } });
    // the member's latest membership (other test files may have changed Alex's tier)
    const latest = await db.membership.findFirstOrThrow({ where: { memberId: alexMember }, orderBy: { issueDate: "desc" }, include: { tier: true } });
    expect(o!.member).toMatchObject({ id: alexMember, email: EMAILS.alex, account: "ACTIVE", tier: latest.tier.displayName, membership: latest.status });
    expect(o!.ticketList).toEqual([expect.objectContaining({ number: alexTicket, code: "FRI", name: "Friday Access" })]);
    expect(await getSalesOrder(admin, "CJ-T-9999")).toBeNull();
    const declined = await getSalesOrder(admin, "CJ-T-0003");
    expect(declined).toMatchObject({ error: "card refused", member: null, ticketList: [] });
  });

  it("lists pre-registrations, newest first, with search", async () => {
    const r = await listPreRegistrations(admin);
    expect(r).toMatchObject({ available: true, total: 2, byTier: { "Ruby Red": 1, "Ultra Black": 1 } });
    expect(r.registrations.map((x) => x.email)).toEqual(["omar@pre.test", "sara@pre.test"]);
    expect(r.registrations[1]).toMatchObject({ firstName: "Sara", source: "Instagram", message: "hi", marketing: true });
    expect((await listPreRegistrations(admin, "sara khan")).registrations.map((x) => x.email)).toEqual(["sara@pre.test"]);
    expect((await listPreRegistrations(admin, "pakistan")).registrations.map((x) => x.email)).toEqual(["omar@pre.test"]);
  });

  it("notes every CSV download in the audit log", async () => {
    const before = await db.auditLog.count({ where: { action: { startsWith: "sales." } } });
    expect(await exportSalesOrders(admin, { ...NO_FILTER, status: "paid" })).toHaveLength(2);
    expect(await exportPreRegistrations(admin, "omar")).toHaveLength(1);
    const logs = await db.auditLog.findMany({ where: { action: { startsWith: "sales." } }, orderBy: { createdAt: "asc" }, skip: before });
    expect(logs.map((l) => [l.action, l.actorUserId])).toEqual([
      ["sales.orders_exported", admin.userId],
      ["sales.registrations_exported", admin.userId],
    ]);
    expect(logs[0].afterData).toMatchObject({ rows: 2, filters: { status: "paid" } });
  });

  it("is for admins only", async () => {
    for (const call of [
      () => getSalesStats(concierge, NO_FILTER),
      () => listSalesOrders(concierge, NO_FILTER),
      () => getSalesOrder(concierge, "CJ-T-0001"),
      () => listPreRegistrations(concierge),
      () => exportSalesOrders(concierge, NO_FILTER),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(AppError);
    }
  });
});
