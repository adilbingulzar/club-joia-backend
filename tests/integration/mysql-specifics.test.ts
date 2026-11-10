import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { conciergeCategoryList, deliveryChannelList } from "@/lib/json-list";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { sha256 } from "@/lib/crypto";
import { createRequest, listRequestsStaff } from "@/services/concierge.service";
import { createMember, listMembers } from "@/services/member.service";
import { createNotification } from "@/services/notification.service";
import { savePushSubscription } from "@/services/notification.service";
import { createStaff, listStaff } from "@/services/staff.service";
import { issueTicket, revokeTicket, searchTickets } from "@/services/ticket.service";
import { actorFor, EMAILS, ticketOf } from "../support/actors";

/**
 * Behaviour that depends on the database engine and was rewritten for MySQL: the rate-limit
 * upsert, membership-number generation, column sizes, collation-based search, JSON lists, UTC
 * handling and the audit-log triggers.
 */

const unique = () => randomBytes(4).toString("hex");

describe("MySQL connection", () => {
  it("runs every session in UTC, whatever the server's time zone", async () => {
    const [row] = await db.$queryRaw<{ tz: string }[]>`SELECT @@session.time_zone AS tz`;
    expect(row.tz).toBe("+00:00");
  });

  it("stores database-defaulted timestamps (CURRENT_TIMESTAMP) in UTC", async () => {
    // Prisma sends created_at itself, so only raw SQL relies on the column default. That default
    // is evaluated in the session time zone, which is why connections are pinned to UTC.
    const admin = await actorFor(EMAILS.admin);
    const id = `tz${unique()}`;
    const before = Date.now();
    await db.$executeRaw`INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (${id}, ${sha256(id)}, ${admin.userId}, UTC_TIMESTAMP(3) + INTERVAL 1 HOUR)`;
    const session = await db.session.findUniqueOrThrow({ where: { id } });
    // Any other session time zone would shift these by whole hours.
    expect(Math.abs(session.createdAt.getTime() - before)).toBeLessThan(60_000);
    expect(Math.abs(session.expiresAt.getTime() - (before + 3_600_000))).toBeLessThan(60_000);
    await db.session.delete({ where: { id } });
  });
});

describe("rate limiter (INSERT … ON DUPLICATE KEY UPDATE)", () => {
  it("counts concurrent hits exactly once each", async () => {
    const key = `test:concurrent:${unique()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => hitRateLimit(key, 10, 60)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    // Every hit read its own count: remaining values 9…0 each appear once among the allowed ones.
    expect(results.filter((r) => r.allowed).map((r) => r.remaining).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const bucket = await db.rateLimitBucket.findUniqueOrThrow({ where: { key: sha256(key) } });
    expect(bucket.count).toBe(30);
  });

  it("starts a new window once the old one has passed", async () => {
    const key = `test:window:${unique()}`;
    for (let i = 0; i < 3; i++) await hitRateLimit(key, 3, 60);
    expect((await hitRateLimit(key, 3, 60)).allowed).toBe(false);
    await db.rateLimitBucket.update({ where: { key: sha256(key) }, data: { windowStart: new Date(Date.now() - 61_000) } });
    const fresh = await hitRateLimit(key, 3, 60);
    expect(fresh).toEqual({ allowed: true, remaining: 2 });
  });
});

describe("membership numbers", () => {
  const newMember = async (tierId: string) => {
    const admin = await actorFor(EMAILS.admin);
    const id = unique();
    const { memberId } = await createMember(admin, { firstName: "Num", lastName: `Test${id}`, email: `num-${id}@joia.test`, tierId, sendInvitation: false });
    return db.member.findUniqueOrThrow({ where: { id: memberId } });
  };

  it("continues from the highest CJ300-NNNN, also under concurrent creation", async () => {
    const tier = await db.membershipTier.findFirstOrThrow();
    const numbers = async () => (await db.member.findMany({ select: { membershipNumber: true } })).map((m) => m.membershipNumber);
    const max = Math.max(...(await numbers()).map((n) => Number(n.slice(6))));

    const first = await newMember(tier.id);
    expect(first.membershipNumber).toBe(`CJ300-${String(max + 1).padStart(4, "0")}`);

    const batch = await Promise.all([newMember(tier.id), newMember(tier.id), newMember(tier.id)]);
    const got = batch.map((m) => Number(m.membershipNumber.slice(6))).sort((a, b) => a - b);
    expect(got).toEqual([max + 2, max + 3, max + 4]);
    expect(new Set(await numbers()).size).toBe((await numbers()).length);
  });
});

describe("column sizes", () => {
  it("accepts the longest values the validators allow", async () => {
    const admin = await actorFor(EMAILS.admin);
    // 254 characters: the maximum emailSchema accepts (Prisma's MySQL default would be 191).
    const local = `long-${unique()}`;
    const email = `${local}@${"d".repeat(254 - local.length - 1 - 5)}.test`;
    expect(email).toHaveLength(254);
    const { userId } = await createStaff(admin, { name: "Long Email", email, role: "CONCIERGE" });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(email);

    // Push endpoint at the column / validator limit (768).
    const alex = await actorFor(EMAILS.alex);
    const prefix = `https://push.example.test/${unique()}/`;
    const endpoint = prefix + "e".repeat(768 - prefix.length);
    await savePushSubscription({ ...alex, userAgent: "u".repeat(600) }, { endpoint, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } });
    const sub = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(sub.endpoint).toHaveLength(768);

    // Long free text: concierge description (3000), notes (1000), revoke reason (200), bio (600).
    const request = await createRequest(alex, { category: "DINING", subject: "Long text check", description: "x".repeat(3000), notes: "n".repeat(1000) });
    const stored = await db.conciergeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.description).toHaveLength(3000);
    expect(stored.notes).toHaveLength(1000);

    const tier = await db.membershipTier.findFirstOrThrow();
    const id = unique();
    const { memberId } = await createMember(admin, { firstName: "Rev", lastName: `Oke${id}`, email: `rev-${id}@joia.test`, tierId: tier.id, sendInvitation: false });
    await db.member.update({ where: { id: memberId }, data: { bio: "b".repeat(600) } });
    const ticketType = await db.ticketType.findFirstOrThrow({ where: { code: "FRI" } });
    const ticket = await issueTicket(admin, { memberId, ticketTypeId: ticketType.id, notify: false });
    const revoked = await revokeTicket(admin, ticket.id, "r".repeat(200));
    expect(revoked.revokeReason).toHaveLength(200);
  });
});

describe("case-insensitive search (utf8mb4_unicode_ci)", () => {
  it("finds members, tickets and concierge requests regardless of case", async () => {
    const admin = await actorFor(EMAILS.admin);
    const members = await listMembers(admin, { q: "ALEX" });
    expect(members.rows.some((m) => m.firstName === "Alex")).toBe(true);

    const ticket = await ticketOf(EMAILS.alex, "FRI");
    const tickets = await searchTickets(admin, { q: ticket.ticketNumber.toLowerCase() });
    expect(tickets.rows.map((t) => t.id)).toContain(ticket.id);

    const alex = await actorFor(EMAILS.alex);
    const request = await createRequest(alex, { category: "HOTEL", subject: "Late Check-Out Please", description: "Room 12, late check-out." });
    const requests = await listRequestsStaff(admin, { q: "late CHECK-out" });
    expect(requests.rows.map((r) => r.id)).toContain(request.id);
  });
});

describe("JSON list columns", () => {
  it("round-trips staff concierge categories as a typed list", async () => {
    const admin = await actorFor(EMAILS.admin);
    const { userId } = await createStaff(admin, { name: "List Check", email: `list-${unique()}@joia.test`, role: "CONCIERGE", conciergeCategories: ["TRANSPORT", "YACHT"] });
    const row = (await listStaff(admin)).find((s) => s.id === userId)!;
    expect(row.conciergeCategories).toEqual(["TRANSPORT", "YACHT"]);
  });

  it("defaults list columns when they are omitted", async () => {
    const admin = await actorFor(EMAILS.admin);
    const { userId } = await createStaff(admin, { name: "Default Check", email: `default-${unique()}@joia.test`, role: "CONCIERGE" });
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).conciergeCategories).toEqual([]);
    const n = await db.notification.create({ data: { title: "t", body: "b", targetType: "ALL_MEMBERS" } });
    expect(deliveryChannelList(n.channels)).toEqual(["IN_APP", "WEB_PUSH"]);
    const notification = await createNotification(admin, { title: "Channel check", body: "Body text", type: "ANNOUNCEMENT", targetType: "MEMBER", targetId: (await actorFor(EMAILS.alex)).memberId, channels: ["IN_APP"] });
    expect(deliveryChannelList((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).channels)).toEqual(["IN_APP"]);
  });

  it("ignores unknown or malformed values in a hand-edited row", () => {
    expect(conciergeCategoryList(["HOTEL", "BOGUS", 5, null])).toEqual(["HOTEL"]);
    expect(conciergeCategoryList({ HOTEL: true })).toEqual([]);
    expect(conciergeCategoryList(null)).toEqual([]);
    expect(deliveryChannelList(["WEB_PUSH", "PIGEON"])).toEqual(["WEB_PUSH"]);
  });
});

describe("audit log triggers", () => {
  it("refuses raw UPDATE and DELETE, not only through Prisma", async () => {
    const row = await db.auditLog.findFirstOrThrow();
    await expect(db.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM audit_logs WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe(row.action);
  });
});
