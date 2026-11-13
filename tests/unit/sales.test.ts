import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/permissions";
import { ordersCsv, registrationsCsv } from "@/lib/sales/csv";
import { previousPeriod, readSalesFilters, salesQuery } from "@/lib/sales/filters";
import { change, compact, percent } from "@/lib/sales/format";
import { revenueSeries } from "@/lib/sales/series";
import type { SalesOrderRow } from "@/services/sales.service";

const NOW = new Date("2026-11-09T08:00:00Z");

describe("sales access", () => {
  it("only admins see the website's sales and pre-registrations", () => {
    expect(can("ADMIN", "sales:view")).toBe(true);
    expect(can("SUPER_ADMIN", "sales:view")).toBe(true);
    for (const role of ["MEMBER", "CHECK_IN_STAFF", "CONCIERGE"] as const) expect(can(role, "sales:view")).toBe(false);
  });
});

describe("sales filters", () => {
  it("turns a preset into Dubai days", () => {
    expect(readSalesFilters({ range: "7d" }, NOW)).toMatchObject({ range: "7d", from: "2026-11-03", to: "2026-11-09" });
    expect(readSalesFilters({ range: "today" }, NOW)).toMatchObject({ from: "2026-11-09", to: "2026-11-09" });
    // 23:30 on 9 Nov UTC is already 10 Nov in Dubai
    expect(readSalesFilters({ range: "today" }, new Date("2026-11-09T23:30:00Z"))).toMatchObject({ from: "2026-11-10" });
  });

  it('takes custom dates, in order, also without "Custom dates" picked', () => {
    expect(readSalesFilters({ range: "custom", from: "2026-11-05", to: "2026-11-01" }, NOW)).toMatchObject({ range: "custom", from: "2026-11-01", to: "2026-11-05" });
    expect(readSalesFilters({ from: "2026-11-01" }, NOW)).toMatchObject({ range: "custom", from: "2026-11-01", to: "" });
    expect(readSalesFilters({ range: "custom", from: "nope" }, NOW)).toMatchObject({ range: "all", from: "", to: "" });
    expect(readSalesFilters({ range: "yesterday", page: "-3", status: "nonsense" }, NOW)).toMatchObject({ range: "all", page: 1, status: "" });
  });

  it("compares with the period just before", () => {
    expect(previousPeriod(readSalesFilters({ range: "7d" }, NOW))).toEqual({ from: "2026-10-27", to: "2026-11-02" });
    expect(previousPeriod(readSalesFilters({}, NOW))).toBeNull();
  });

  it("builds the page links", () => {
    const f = readSalesFilters({ range: "30d", status: "paid", tier: "ruby-red", q: "ali", page: "2" }, NOW);
    expect(salesQuery(f)).toBe("?range=30d&status=paid&tier=ruby-red&q=ali&page=2");
    expect(salesQuery(f, { status: "", page: 1 })).toBe("?range=30d&tier=ruby-red&q=ali");
    expect(salesQuery(readSalesFilters({ from: "2026-11-01", to: "2026-11-02" }, NOW))).toBe("?range=custom&from=2026-11-01&to=2026-11-02");
  });
});

describe("sales revenue series", () => {
  it("has every day of the range, empty ones at zero", () => {
    const s = revenueSeries([{ day: "2026-11-03", revenue: 8000, paid: 1, orders: 2 }], "2026-11-02", "2026-11-04", NOW);
    expect(s.map((b) => [b.key, b.revenue, b.orders])).toEqual([["2026-11-02", 0, 0], ["2026-11-03", 8000, 2], ["2026-11-04", 0, 0]]);
  });

  it("runs from the first order to today without a range, in weeks past 92 days", () => {
    expect(revenueSeries([{ day: "2026-11-01", revenue: 1, paid: 1, orders: 1 }], "", "", NOW)).toHaveLength(9);
    const long = revenueSeries([{ day: "2026-01-01", revenue: 5, paid: 1, orders: 1 }, { day: "2026-01-07", revenue: 5, paid: 1, orders: 1 }], "2026-01-01", "2026-11-09", NOW);
    expect(long[0]).toMatchObject({ from: "2026-01-01", to: "2026-01-07", revenue: 10 });
    expect(long[long.length - 1].to).toBe("2026-11-09");
  });
});

describe("sales formats", () => {
  it("shows figures as the charts need them", () => {
    expect(compact(8000)).toBe("8,000");
    expect(compact(25000)).toBe("25K");
    expect(compact(1500000)).toBe("1.5M");
    expect(percent(1, 3)).toBe("33%");
    expect(percent(0, 0)).toBe("0%");
    expect(change(120, 100)).toEqual({ text: "+20%", up: true });
    expect(change(50, 100)).toEqual({ text: "−50%", up: false });
    expect(change(5, 0)).toBeNull();
  });
});

describe("sales CSV", () => {
  it("quotes what needs it and keeps formulas out of Excel", () => {
    const order: SalesOrderRow = {
      ref: "CJ1", status: "paid", createdAt: new Date("2026-11-09T06:00:00Z"), paidAt: new Date("2026-11-09T06:05:00Z"),
      buyer: { name: '=HYPERLINK("x")', email: "a@b.co", mobile: "+92 300", country: "pakistan" },
      items: [{ productId: "ruby-red/3-days", name: "Ruby Red, 3 days", quantity: 2, price: 8000 }],
      amount: 16000, currency: "AED", tickets: 8, error: null,
    };
    const lines = ordersCsv([order]).replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"9 Nov 2026, 10:00",CJ1,Paid,"\'=HYPERLINK(""x"")",a@b.co,\'+92 300,pakistan,"2 × Ruby Red, 3 days",2,16000,AED,"9 Nov 2026, 10:05",8,');
    const reg = registrationsCsv([
      { createdAt: new Date("2026-11-09T06:00:00Z"), updatedAt: new Date("2026-11-09T06:00:00Z"), firstName: "Sara", lastName: "Khan", email: "s@k.co", phone: "+971 50", country: "UAE", tier: "Ruby Red", source: "", message: "hi, there", marketing: true },
    ]);
    expect(reg.startsWith("﻿")).toBe(true);
    expect(reg.trim().split("\r\n")[1]).toBe('"9 Nov 2026, 10:00","9 Nov 2026, 10:00",Sara,Khan,s@k.co,\'+971 50,UAE,Ruby Red,,"hi, there",yes');
  });
});
