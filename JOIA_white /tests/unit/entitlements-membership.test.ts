import { describe, expect, it } from "vitest";
import { coerceEntitlementValue, hasEntitlement, resolveEntitlements } from "@/domain/entitlements";
import { canTransitionMembership, effectiveMembershipStatus, isMembershipUsable, pickCurrentMembership } from "@/domain/membership";

const now = new Date("2026-12-04T10:00:00Z");

describe("entitlement checking", () => {
  it("resolves tier grants with typed values", () => {
    const map = resolveEntitlements(
      [
        { code: "vip_deck_access", valueType: "BOOLEAN", value: true },
        { code: "guest_passes", valueType: "INTEGER", value: 2 },
        { code: "concierge_level", valueType: "TEXT", value: "dedicated" },
        { code: "broken", valueType: "INTEGER", value: "abc" },
      ],
      [],
      now,
    );
    expect(map).toEqual({ vip_deck_access: true, guest_passes: 2, concierge_level: "dedicated" });
  });

  it("lets member overrides grant and revoke, ignoring expired overrides", () => {
    const map = resolveEntitlements(
      [{ code: "vip_deck_access", valueType: "BOOLEAN", value: true }],
      [
        { code: "vip_deck_access", valueType: "BOOLEAN", value: false, expiresAt: null },
        { code: "premium_parking", valueType: "BOOLEAN", value: true, expiresAt: new Date("2026-12-10") },
        { code: "afterparty_access", valueType: "BOOLEAN", value: true, expiresAt: new Date("2026-12-01") },
      ],
      now,
    );
    expect(hasEntitlement(map, "vip_deck_access")).toBe(false);
    expect(hasEntitlement(map, "premium_parking")).toBe(true);
    expect(hasEntitlement(map, "afterparty_access")).toBe(false);
  });

  it("treats zero, empty and 'none' as not entitled", () => {
    expect(hasEntitlement({ guest_passes: 0 }, "guest_passes")).toBe(false);
    expect(hasEntitlement({ guest_passes: 1 }, "guest_passes")).toBe(true);
    expect(hasEntitlement({ concierge_level: "none" }, "concierge_level")).toBe(false);
    expect(hasEntitlement({}, "anything")).toBe(false);
  });

  it("coerces raw JSON values safely", () => {
    expect(coerceEntitlementValue("BOOLEAN", "true")).toBe(true);
    expect(coerceEntitlementValue("BOOLEAN", 1)).toBeNull();
    expect(coerceEntitlementValue("INTEGER", "3")).toBe(3);
    expect(coerceEntitlementValue("INTEGER", 2.5)).toBeNull();
  });
});

describe("membership status", () => {
  it("only ACTIVE memberships are usable", () => {
    expect(isMembershipUsable("ACTIVE")).toBe(true);
    for (const s of ["INVITED", "SUSPENDED", "EXPIRED", "CANCELLED"] as const) expect(isMembershipUsable(s)).toBe(false);
  });

  it("enforces allowed transitions", () => {
    expect(canTransitionMembership("INVITED", "ACTIVE")).toBe(true);
    expect(canTransitionMembership("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionMembership("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionMembership("CANCELLED", "ACTIVE")).toBe(false);
    expect(canTransitionMembership("INVITED", "SUSPENDED")).toBe(false);
  });

  it("picks the newest active membership, falling back to the newest", () => {
    const a = { id: "a", status: "EXPIRED" as const, issueDate: new Date("2026-01-01"), endDate: null };
    const b = { id: "b", status: "ACTIVE" as const, issueDate: new Date("2025-01-01"), endDate: null };
    const c = { id: "c", status: "SUSPENDED" as const, issueDate: new Date("2026-06-01"), endDate: null };
    expect(pickCurrentMembership([a, b, c])?.id).toBe("b");
    expect(pickCurrentMembership([a, c])?.id).toBe("c");
    expect(pickCurrentMembership([])).toBeNull();
  });

  it("treats active memberships past their end date as expired", () => {
    const m = { status: "ACTIVE" as const, issueDate: now, endDate: new Date("2026-11-30T00:00:00Z") };
    expect(effectiveMembershipStatus(m, "2026-12-04")).toBe("EXPIRED");
    expect(effectiveMembershipStatus(m, "2026-11-30")).toBe("ACTIVE");
  });
});
