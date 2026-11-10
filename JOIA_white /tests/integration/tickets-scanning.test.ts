import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { checkIn, issueQrForMyTicket, scan } from "@/services/qr.service";
import { getMyTicket, listMyTickets, reissueCredential, revokeTicket } from "@/services/ticket.service";
import { assignMembership, setMembershipStatus } from "@/services/membership.service";
import { actorFor, EMAILS, FRIDAY_AFTERNOON, SUNDAY_NIGHT, ticketOf, zoneId } from "../support/actors";

/** The clock is frozen inside the event weekend so tickets are within their windows. */
function freeze(at: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
}

describe("ticket display", () => {
  it("lists a member's own tickets and issues a signed QR", async () => {
    const alex = await actorFor(EMAILS.alex);
    const tickets = await listMyTickets(alex);
    expect(tickets.map((t) => t.ticketType.code).sort()).toEqual(["FRI", "SAT", "SUN"]);
    const qr = await issueQrForMyTicket(alex, tickets[0].ticketNumber);
    expect(qr.token).toMatch(/^CJ1\./);
    expect(qr.token).not.toContain(tickets[0].id);
    expect(qr.token).not.toContain(alex.memberId!);
  });

  it("never reveals another member's ticket", async () => {
    const sophia = await actorFor(EMAILS.sophia);
    const alexTicket = await ticketOf(EMAILS.alex, "FRI");
    await expect(getMyTicket(sophia, alexTicket.ticketNumber)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(issueQrForMyTicket(sophia, alexTicket.ticketNumber)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ticket scanning", () => {
  beforeEach(() => freeze(FRIDAY_AFTERNOON));
  afterEach(() => vi.useRealTimers());

  it("validates a QR, checks the member in, and logs every step", async () => {
    const [alex, scanner] = await Promise.all([actorFor(EMAILS.alex), actorFor(EMAILS.scanner)]);
    const ticket = await ticketOf(EMAILS.alex, "FRI");
    const { token } = await issueQrForMyTicket(alex, ticket.ticketNumber);
    const main = await zoneId("MAIN");

    const outcome = await scan(scanner, { token, zoneId: main }, new Date());
    expect(outcome).toMatchObject({ result: "VALID", canCheckIn: true, severity: "success" });
    expect(outcome.member).toMatchObject({ name: "Alex Carter", tier: "Ruby Red", membershipNumber: "CJ300-0001" });
    expect(Object.keys(outcome.member!)).not.toContain("email");

    const admitted = await checkIn(scanner, outcome.scanLogId, new Date());
    expect(admitted.result).toBe("VALID");
    expect(await db.ticketCheckIn.count({ where: { ticketId: ticket.id } })).toBe(1);
    expect(await db.ticketScanLog.count({ where: { ticketId: ticket.id } })).toBe(2);
  });

  it("applies membership entitlements to zones (VIP deck)", async () => {
    const scanner = await actorFor(EMAILS.scanner);
    const vip = await zoneId("VIP_DECK");
    const ruby = await scan(scanner, { ticketNumber: (await ticketOf(EMAILS.alex, "FRI")).ticketNumber, zoneId: vip }, new Date());
    expect(ruby).toMatchObject({ result: "WRONG_ACCESS_ZONE", reason: "ENTITLEMENT_MISSING" });
    const pearl = await scan(scanner, { ticketNumber: (await ticketOf(EMAILS.sophia, "FRI")).ticketNumber, zoneId: vip }, new Date());
    expect(pearl.result).toBe("VALID");
  });

  it("rejects forged and unknown codes without revealing member data", async () => {
    const scanner = await actorFor(EMAILS.scanner);
    const main = await zoneId("MAIN");
    const forged = await scan(scanner, { token: "CJ1.eyJyIjoieCIsIm4iOiJ5IiwiZSI6OTk5OTk5OTk5OX0.AAAA", zoneId: main }, new Date());
    expect(forged).toMatchObject({ result: "INVALID", reason: "QR_FORGED", member: null });
    const unknown = await scan(scanner, { ticketNumber: "AD26-FRI-NOPE00", zoneId: main }, new Date());
    expect(unknown).toMatchObject({ result: "INVALID", reason: "UNKNOWN_TICKET" });
    expect(await db.ticketScanLog.count({ where: { result: "INVALID" } })).toBeGreaterThanOrEqual(2);
  });

  it("reports NOT_VALID_YET before the window opens", async () => {
    const scanner = await actorFor(EMAILS.scanner);
    const r = await scan(scanner, { ticketNumber: (await ticketOf(EMAILS.alex, "SUN")).ticketNumber, zoneId: await zoneId("MAIN") }, new Date());
    expect(r.result).toBe("NOT_VALID_YET");
  });

  it("refuses check-in by a different staff member or for a non-valid scan", async () => {
    const [scanner, manager] = await Promise.all([actorFor(EMAILS.scanner), actorFor(EMAILS.manager)]);
    const r = await scan(scanner, { ticketNumber: (await ticketOf(EMAILS.marcus, "FRI")).ticketNumber, zoneId: await zoneId("MAIN") }, new Date());
    await expect(checkIn(manager, r.scanLogId, new Date())).rejects.toMatchObject({ code: "INVALID_STATE" });
    const bad = await scan(scanner, { ticketNumber: (await ticketOf(EMAILS.marcus, "SUN")).ticketNumber, zoneId: await zoneId("MAIN") }, new Date());
    await expect(checkIn(scanner, bad.scanLogId, new Date())).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("members cannot scan", async () => {
    const alex = await actorFor(EMAILS.alex);
    await expect(scan(alex, { ticketNumber: "X", zoneId: await zoneId("MAIN") }, new Date())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("single entry", () => {
  beforeEach(() => freeze(SUNDAY_NIGHT));
  afterEach(() => vi.useRealTimers());

  it("admits once, then ALREADY_USED, and marks the ticket used", async () => {
    const scanner = await actorFor(EMAILS.scanner);
    const ticket = await ticketOf(EMAILS.marcus, "AFTER");
    const zone = await zoneId("AFTER_PARTY");
    const first = await scan(scanner, { ticketNumber: ticket.ticketNumber, zoneId: zone }, new Date());
    expect(first.result).toBe("VALID");
    await checkIn(scanner, first.scanLogId, new Date());
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("USED");
    const second = await scan(scanner, { ticketNumber: ticket.ticketNumber, zoneId: zone }, new Date());
    expect(second.result).toBe("ALREADY_USED");
  });
});

describe("ticket revocation", () => {
  beforeEach(() => freeze(FRIDAY_AFTERNOON));
  afterEach(() => vi.useRealTimers());

  it("a revoked ticket's QR fails at the door and the member can no longer get a QR", async () => {
    const [sophia, scanner, admin] = await Promise.all([actorFor(EMAILS.sophia), actorFor(EMAILS.scanner), actorFor(EMAILS.admin)]);
    const ticket = await ticketOf(EMAILS.sophia, "SAT");
    vi.setSystemTime(new Date("2026-12-05T10:00:00Z"));
    const { token } = await issueQrForMyTicket(sophia, ticket.ticketNumber);
    expect((await scan(scanner, { token, zoneId: await zoneId("MAIN") }, new Date())).result).toBe("VALID");

    await revokeTicket(admin, ticket.id, "Issued in error");
    const after = await scan(scanner, { token, zoneId: await zoneId("MAIN") }, new Date());
    expect(after).toMatchObject({ result: "REVOKED", severity: "danger", canCheckIn: false });
    await expect(issueQrForMyTicket(sophia, ticket.ticketNumber)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await db.auditLog.count({ where: { action: "ticket.revoke", entityId: ticket.id } })).toBe(1);
  });

  it("reissuing a credential invalidates old QR codes but not the ticket", async () => {
    const [alex, scanner, admin] = await Promise.all([actorFor(EMAILS.alex), actorFor(EMAILS.scanner), actorFor(EMAILS.admin)]);
    const ticket = await ticketOf(EMAILS.alex, "FRI");
    const old = await issueQrForMyTicket(alex, ticket.ticketNumber);
    await reissueCredential(admin, ticket.id);
    expect((await scan(scanner, { token: old.token, zoneId: await zoneId("MAIN") }, new Date())).reason).toBe("CREDENTIAL_REPLACED");
    const fresh = await issueQrForMyTicket(alex, ticket.ticketNumber);
    expect((await scan(scanner, { token: fresh.token, zoneId: await zoneId("MAIN") }, new Date())).result).toBe("VALID");
  });

  it("suspending a membership stops access", async () => {
    const [scanner, admin] = await Promise.all([actorFor(EMAILS.scanner), actorFor(EMAILS.admin)]);
    const marcus = await db.member.findFirstOrThrow({ where: { user: { email: EMAILS.marcus } } });
    await setMembershipStatus(admin, marcus.id, "SUSPENDED");
    const r = await scan(scanner, { ticketNumber: (await ticketOf(EMAILS.marcus, "FRI")).ticketNumber, zoneId: await zoneId("MAIN") }, new Date());
    expect(r).toMatchObject({ result: "SUSPENDED", reason: "MEMBERSHIP_INACTIVE" });
    await setMembershipStatus(admin, marcus.id, "ACTIVE");
  });
});

describe("admin membership update", () => {
  it("changes tier, audits it, and only admins may do it", async () => {
    const [admin, alex, concierge] = await Promise.all([actorFor(EMAILS.admin), actorFor(EMAILS.alex), actorFor(EMAILS.concierge)]);
    const black = await db.membershipTier.findUniqueOrThrow({ where: { slug: "ultra-black" } });
    await expect(assignMembership(alex, alex.memberId!, { tierId: black.id, status: "ACTIVE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignMembership(concierge, alex.memberId!, { tierId: black.id, status: "ACTIVE" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const updated = await assignMembership(admin, alex.memberId!, { tierId: black.id, status: "ACTIVE" });
    expect(updated.tierId).toBe(black.id);
    expect(await db.auditLog.count({ where: { action: "membership.update", entityId: updated.id } })).toBeGreaterThan(0);
    // Tier change notifies the member in-app.
    expect(await db.notificationRecipient.count({ where: { memberId: alex.memberId!, deliveryChannel: "IN_APP", notification: { type: "MEMBERSHIP" } } })).toBe(1);
  });
});
