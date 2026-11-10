import { describe, expect, it } from "vitest";
import { can, homePathFor } from "@/lib/auth/permissions";
import { canSeeInternalNotes, canViewConciergeRequest, memberCanCancel, memberCanReply } from "@/domain/concierge";
import { safeNextPath } from "@/validators/auth";
import { eachDay, localDateString, zonedToUtc } from "@/lib/time";

describe("RBAC", () => {
  it("members cannot reach admin or scanner capabilities", () => {
    for (const p of ["admin:access", "members:view", "tickets:manage", "scan:validate", "concierge:view_all", "audit:view"] as const) {
      expect(can("MEMBER", p)).toBe(false);
    }
    expect(can("MEMBER", "self:tickets")).toBe(true);
  });

  it("check-in staff can scan but not browse members or concierge notes", () => {
    expect(can("CHECK_IN_STAFF", "scan:check_in")).toBe(true);
    expect(can("CHECK_IN_STAFF", "members:view")).toBe(false);
    expect(can("CHECK_IN_STAFF", "members:view_basic")).toBe(false);
    expect(can("CHECK_IN_STAFF", "concierge:internal_notes")).toBe(false);
  });

  it("concierge manages requests but not tickets, roles or settings", () => {
    expect(can("CONCIERGE", "concierge:manage")).toBe(true);
    expect(can("CONCIERGE", "tickets:manage")).toBe(false);
    expect(can("CONCIERGE", "staff:manage")).toBe(false);
    expect(can("CONCIERGE", "settings:manage")).toBe(false);
  });

  it("only super admins manage staff, settings and event configuration", () => {
    expect(can("ADMIN", "staff:manage")).toBe(false);
    expect(can("ADMIN", "events:manage")).toBe(false);
    expect(can("ADMIN", "programme:manage")).toBe(true);
    expect(can("SUPER_ADMIN", "staff:manage")).toBe(true);
    expect(can("SUPER_ADMIN", "settings:manage")).toBe(true);
  });

  it("routes each role to its home", () => {
    expect(homePathFor("MEMBER")).toBe("/");
    expect(homePathFor("CHECK_IN_STAFF")).toBe("/staff/scanner");
    expect(homePathFor("CONCIERGE")).toBe("/admin/concierge");
    expect(homePathFor("ADMIN")).toBe("/admin");
  });
});

describe("concierge permissions", () => {
  const req = { memberId: "m1" };
  it("members see only their own requests", () => {
    expect(canViewConciergeRequest({ role: "MEMBER", memberId: "m1" }, req)).toBe(true);
    expect(canViewConciergeRequest({ role: "MEMBER", memberId: "m2" }, req)).toBe(false);
    expect(canViewConciergeRequest({ role: "MEMBER", memberId: null }, req)).toBe(false);
  });
  it("staff visibility follows permissions", () => {
    expect(canViewConciergeRequest({ role: "CONCIERGE", memberId: null }, req)).toBe(true);
    expect(canViewConciergeRequest({ role: "CHECK_IN_STAFF", memberId: null }, req)).toBe(false);
  });
  it("internal notes are staff-only", () => {
    expect(canSeeInternalNotes("MEMBER")).toBe(false);
    expect(canSeeInternalNotes("CHECK_IN_STAFF")).toBe(false);
    expect(canSeeInternalNotes("CONCIERGE")).toBe(true);
  });
  it("members can cancel/reply only while open", () => {
    expect(memberCanCancel("NEW")).toBe(true);
    expect(memberCanCancel("CONFIRMED")).toBe(false);
    expect(memberCanReply("CONFIRMED")).toBe(true);
    expect(memberCanReply("COMPLETED")).toBe(false);
  });
});

describe("helpers", () => {
  it("only allows same-site relative redirects", () => {
    expect(safeNextPath("/tickets")).toBe("/tickets");
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
  });

  it("converts Abu Dhabi wall-clock times correctly", () => {
    expect(zonedToUtc("2026-12-04", "12:30", "Asia/Dubai").toISOString()).toBe("2026-12-04T08:30:00.000Z");
    expect(localDateString(new Date("2026-12-04T21:00:00Z"), "Asia/Dubai")).toBe("2026-12-05");
    expect(eachDay("2026-12-04", "2026-12-06")).toEqual(["2026-12-04", "2026-12-05", "2026-12-06"]);
  });
});
