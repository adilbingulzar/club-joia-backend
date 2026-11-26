import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/services/context";

const m = vi.hoisted(() => ({ queries: [] as { sql: string; params: unknown[] }[], rows: [] as unknown[][], audits: [] as string[] }));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      m.queries.push({ sql, params });
      return m.rows.shift() ?? [];
    },
  },
}));
vi.mock("@/lib/config/env", () => ({ env: () => ({ SHOP_API_URL: process.env.SHOP_API_URL, SHOP_ADMIN_KEY: process.env.SHOP_ADMIN_KEY }) }));
vi.mock("@/services/audit.service", () => ({ recordAudit: async (_a: unknown, e: { action: string }) => void m.audits.push(e.action) }));

const svc = await import("@/services/payment-links.service");
const viewer: Actor = { userId: "sv1", role: "SALES_VIEWER", memberId: null };
const superAdmin: Actor = { userId: "sa1", role: "SUPER_ADMIN", memberId: null };
const buyer = { firstName: "Erin", lastName: "Test", email: "erin@example.com", address: "Street 1", zipcode: "12345", city: "Dubai", country: "AE", gender: "", birthday: "", phoneCode: "AE", phone: "501234567", over21: true, terms: true };

let calls: { url: string; body: unknown; auth: string | null }[] = [];
function website(answer: (action: string, body: Record<string, unknown>) => [number, unknown]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
    const [status, json] = answer(url.split("/api/staff/")[1], body);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  m.queries = [];
  m.rows = [];
  m.audits = [];
  calls = [];
  vi.stubEnv("SHOP_API_URL", "https://site.test/");
  vi.stubEnv("SHOP_ADMIN_KEY", "k".repeat(32));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("payment links", () => {
  it("are off without the website's address and key", async () => {
    vi.stubEnv("SHOP_ADMIN_KEY", "");
    expect(svc.paymentLinksConfigured()).toBe(false);
    await expect(svc.createPaymentLink(viewer, buyer, [{ id: "ruby-red/sat", quantity: 1 }])).rejects.toThrow(/SHOP_API_URL and SHOP_ADMIN_KEY/);
  });

  it("books the order on the website with who made it, with the key", async () => {
    website(() => [200, { ref: "CJ1", url: "https://site.test/shop/link/CJ1", amount: 3000, currency: "USD", expiresAt: "2026-11-26T10:00:00.000Z", emailed: true }]);
    const made = await svc.createPaymentLink(viewer, buyer, [{ id: "ruby-red/sat", quantity: 1 }], { linkDays: 2, sendEmail: true });
    expect(made).toMatchObject({ ref: "CJ1", emailed: true });
    expect(calls[0]).toEqual({
      url: "https://site.test/api/staff/order",
      auth: "Bearer " + "k".repeat(32),
      body: { createdBy: "sv1", buyer, items: [{ id: "ruby-red/sat", quantity: 1 }], linkDays: 2, discount: 0, sendEmail: true },
    });
    expect(m.audits).toEqual(["sales.payment_link_created"]);
  });

  it("sends the discount to the website and keeps it in the audit log", async () => {
    website(() => [200, { ref: "CJD", url: "https://site.test/shop/link/CJD", amount: 2750, discount: 250, currency: "USD", expiresAt: "2026-11-27T10:00:00Z", emailed: false }]);
    const made = await svc.createPaymentLink(viewer, buyer, [{ id: "ruby-red/sat", quantity: 1 }], { linkDays: 1, sendEmail: false, discount: 250 });
    expect((calls[0].body as Record<string, unknown>).discount).toBe(250);
    expect(made).toMatchObject({ amount: 2750, discount: 250 });
    expect(m.audits).toEqual(["sales.payment_link_created"]);
  });

  it("shows the website's checkout message, and is closed to roles without it", async () => {
    website(() => [400, { error: "Please enter a valid zip code." }]);
    await expect(svc.createPaymentLink(viewer, buyer, [{ id: "ruby-red/sat", quantity: 1 }])).rejects.toThrow("Please enter a valid zip code.");
    await expect(svc.createPaymentLink(viewer, buyer, [])).rejects.toThrow(/at least one ticket/);
    await expect(svc.createPaymentLink({ ...viewer, role: "CHECK_IN_STAFF" }, buyer, [{ id: "ruby-red/sat", quantity: 1 }])).rejects.toThrow();
  });

  it("lists a sales viewer's own links, and all of them for super admins", async () => {
    const row = { created_at: "2026-11-24T10:00:00Z", buyer: JSON.stringify({ firstName: "Erin", lastName: "Test" }), email: "erin@example.com", items: JSON.stringify([{ name: "Ruby Red, Saturday", quantity: 1 }]), amount: "3000.00", currency: "USD", staff_cancelled_at: null, link_expires_at: "2026-11-25T10:00:00Z", made_by: "Sam", paid_ref: null };
    // the discount column's check (once), the count, the page
    m.rows = [[{ 1: 1 }], [{ n: 2 }], [{ ...row, ref: "CJ1", expired: 0, discount: "250.00" }, { ...row, ref: "CJ0", expired: 1, discount: null }]];
    const own = await svc.listPaymentLinks(viewer);
    expect(m.queries[0].sql).toContain("column_name = 'discount'");
    expect(m.queries[1].sql).toContain("o.created_by = ?");
    expect(m.queries[1].params).toEqual(["sv1"]);
    expect(m.queries[2].sql).toContain("o.discount");
    expect(own.links[0]).toMatchObject({ ref: "CJ1", buyerName: "Erin Test", state: "unpaid", url: "https://site.test/shop/link/CJ1", amount: 3000, discount: 250, expiresAt: new Date("2026-11-25T10:00:00Z") });
    expect(own.links[1]).toMatchObject({ state: "expired", discount: 0 });
    m.queries = [];
    m.rows = [[{ n: 0 }], []];
    const all = await svc.listPaymentLinks(superAdmin);
    expect(all.all).toBe(true);
    expect(m.queries[0].sql).not.toContain("o.created_by = ?");
  });

  it("cancels only a sales viewer's own unpaid links", async () => {
    website(() => [200, { result: "cancelled" }]);
    m.rows = [[{ ref: "CJ1", created_by: "someone-else" }]];
    await expect(svc.cancelPaymentLink(viewer, "CJ1")).rejects.toThrow(/not found/);
    expect(calls).toHaveLength(0);
    m.rows = [[{ ref: "CJ1", created_by: "sv1" }]];
    await svc.cancelPaymentLink(viewer, "CJ1");
    expect(calls[0].body).toEqual({ ref: "CJ1" });
    website(() => [200, { result: "paid" }]);
    m.rows = [[{ ref: "CJ2", created_by: "someone-else" }]];
    await expect(svc.cancelPaymentLink(superAdmin, "CJ2")).rejects.toThrow(/paid already/);
  });
});
