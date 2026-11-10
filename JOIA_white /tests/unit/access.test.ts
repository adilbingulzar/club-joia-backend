import { describe, expect, it } from "vitest";
import { evaluateAccess, isTicketFullyUsed, scanSeverity, type AccessInput } from "@/domain/access";

const base = (): AccessInput => ({
  now: new Date("2026-12-04T10:00:00Z"),
  localDate: "2026-12-04",
  credential: { revokedAt: null, revokeReason: null },
  ticket: {
    status: "ACTIVE",
    validFrom: new Date("2026-12-04T05:00:00Z"),
    validUntil: new Date("2026-12-04T23:00:00Z"),
    entryPolicy: "MULTI_ENTRY",
    zoneIds: ["main", "vip"],
  },
  userStatus: "ACTIVE",
  membershipStatus: "ACTIVE",
  zone: { id: "main", active: true, requiredEntitlementCode: null },
  entitlements: { event_access: true },
  checkIns: [],
});

const with_ = (patch: (i: AccessInput) => void) => {
  const i = base();
  patch(i);
  return evaluateAccess(i);
};

describe("ticket validation", () => {
  it("admits a valid ticket", () => {
    expect(evaluateAccess(base())).toEqual({ result: "VALID", reason: "OK", entryKey: null });
  });

  it("rejects a revoked ticket", () => {
    expect(with_((i) => (i.ticket.status = "REVOKED")).result).toBe("REVOKED");
  });

  it("rejects a superseded credential even if the ticket is fine", () => {
    expect(with_((i) => (i.credential = { revokedAt: new Date(), revokeReason: "Superseded" }))).toMatchObject({ result: "REVOKED", reason: "CREDENTIAL_REPLACED" });
  });

  it("treats suspended tickets, disabled accounts and inactive memberships as SUSPENDED", () => {
    expect(with_((i) => (i.ticket.status = "SUSPENDED")).result).toBe("SUSPENDED");
    expect(with_((i) => (i.userStatus = "DISABLED")).result).toBe("SUSPENDED");
    expect(with_((i) => (i.membershipStatus = "SUSPENDED")).result).toBe("SUSPENDED");
    expect(with_((i) => (i.membershipStatus = "EXPIRED")).result).toBe("SUSPENDED");
    expect(with_((i) => (i.membershipStatus = null)).result).toBe("INVALID");
  });

  it("checks the validity window", () => {
    expect(with_((i) => (i.now = new Date("2026-12-04T04:59:00Z"))).result).toBe("NOT_VALID_YET");
    expect(with_((i) => (i.now = new Date("2026-12-04T23:01:00Z"))).result).toBe("EXPIRED");
    expect(with_((i) => (i.ticket.status = "EXPIRED")).result).toBe("EXPIRED");
  });

  it("checks the access zone and zone entitlements", () => {
    expect(with_((i) => (i.zone = { id: "parking", active: true, requiredEntitlementCode: null }))).toMatchObject({ result: "WRONG_ACCESS_ZONE", reason: "ZONE_NOT_ON_TICKET" });
    expect(with_((i) => (i.zone = { id: "vip", active: true, requiredEntitlementCode: "vip_deck_access" }))).toMatchObject({ result: "WRONG_ACCESS_ZONE", reason: "ENTITLEMENT_MISSING" });
    expect(
      with_((i) => {
        i.zone = { id: "vip", active: true, requiredEntitlementCode: "vip_deck_access" };
        i.entitlements.vip_deck_access = true;
      }).result,
    ).toBe("VALID");
    expect(with_((i) => (i.zone.active = false)).reason).toBe("ZONE_INACTIVE");
  });

  it("enforces entry policies", () => {
    const single = (checkIns: AccessInput["checkIns"]) =>
      with_((i) => {
        i.ticket.entryPolicy = "SINGLE_ENTRY";
        i.checkIns = checkIns;
      });
    expect(single([])).toMatchObject({ result: "VALID", entryKey: "once" });
    expect(single([{ zoneId: "main", localDate: "2026-12-03" }]).result).toBe("ALREADY_USED");
    expect(single([{ zoneId: "vip", localDate: "2026-12-04" }]).result).toBe("VALID"); // other zone

    const daily = (checkIns: AccessInput["checkIns"]) =>
      with_((i) => {
        i.ticket.entryPolicy = "DAILY_ENTRY";
        i.checkIns = checkIns;
      });
    expect(daily([{ zoneId: "main", localDate: "2026-12-03" }])).toMatchObject({ result: "VALID", entryKey: "day:2026-12-04" });
    expect(daily([{ zoneId: "main", localDate: "2026-12-04" }]).result).toBe("ALREADY_USED");

    expect(with_((i) => (i.checkIns = [{ zoneId: "main", localDate: "2026-12-04" }])).result).toBe("VALID"); // multi
    expect(with_((i) => (i.ticket.status = "USED")).result).toBe("ALREADY_USED");
  });

  it("prioritises hard denials over timing and zone", () => {
    expect(
      with_((i) => {
        i.ticket.status = "REVOKED";
        i.now = new Date("2027-01-01T00:00:00Z");
        i.zone.id = "nowhere";
      }).result,
    ).toBe("REVOKED");
  });

  it("marks single-entry tickets used only once every zone is consumed", () => {
    expect(isTicketFullyUsed("SINGLE_ENTRY", ["a", "b"], ["a"])).toBe(false);
    expect(isTicketFullyUsed("SINGLE_ENTRY", ["a", "b"], ["a", "b"])).toBe(true);
    expect(isTicketFullyUsed("MULTI_ENTRY", ["a"], ["a"])).toBe(false);
  });

  it("maps results to scanner colours", () => {
    expect(scanSeverity("VALID")).toBe("success");
    expect(scanSeverity("ALREADY_USED")).toBe("warning");
    expect(scanSeverity("EXPIRED", "QR_EXPIRED")).toBe("warning");
    expect(scanSeverity("EXPIRED", "TICKET_EXPIRED")).toBe("danger");
    expect(scanSeverity("REVOKED")).toBe("danger");
    expect(scanSeverity("INVALID")).toBe("danger");
  });
});
