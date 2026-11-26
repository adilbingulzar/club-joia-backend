import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as listRoute } from "@/app/api/scan/tickets/route";
import { GET as oneRoute, PUT as putRoute } from "@/app/api/scan/tickets/[ticketId]/route";
import { SCAN_API_USER_EMAIL } from "@/services/scan-api.service";
import { EMAILS, ticketOf } from "../support/actors";

const KEY = "test-scan-api-key-0001";
process.env.SCAN_API_KEY = KEY;

function req(path: string, init: { key?: string | null; method?: string; body?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip ?? "203.0.113.10", "user-agent": "door-scanner/1" };
  if (init.key !== null) headers["x-api-key"] = init.key ?? KEY;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request("https://admin.example.com" + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const params = (ticketId: string) => ({ params: Promise.resolve({ ticketId }) });
const put = (ticketId: string, body: unknown, key?: string) =>
  putRoute(req("/api/scan/tickets/" + ticketId, { method: "PUT", body, key }), params(ticketId));

describe("scanner API", () => {
  afterAll(async () => {
    // leave the seeded tickets as they were for the other test files
    for (const code of ["SAT", "PARK"]) {
      const t = await ticketOf(EMAILS.marcus, code);
      await db.ticketCheckIn.deleteMany({ where: { ticketId: t.id } });
      await db.ticket.update({ where: { id: t.id }, data: { status: "ACTIVE" } });
    }
  });

  it("needs the API key", async () => {
    const none = await listRoute(req("/api/scan/tickets", { key: null, ip: "203.0.113.20" }));
    expect(none.status).toBe(401);
    const wrong = await listRoute(req("/api/scan/tickets", { key: "nope", ip: "203.0.113.20" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Missing or wrong API key." });
  });

  it("blocks wrong keys from an address after 20, but the right key still works", async () => {
    const ip = "203.0.113.30";
    for (let i = 0; i < 20; i++) expect((await listRoute(req("/api/scan/tickets", { key: "wrong", ip }))).status).toBe(401);
    expect((await listRoute(req("/api/scan/tickets", { key: "wrong", ip }))).status).toBe(429);
    // the door scanner behind the same address keeps working
    expect((await listRoute(req("/api/scan/tickets", { ip }))).status).toBe(200);
    // right keys don't use up the allowance
    for (let i = 0; i < 25; i++) expect((await listRoute(req("/api/scan/tickets", { ip: "203.0.113.31" }))).status).toBe(200);
  });

  it("lists every ticket with its holder", async () => {
    const res = await listRoute(req("/api/scan/tickets"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.count).toBe(await db.ticket.count());
    const sat = await ticketOf(EMAILS.marcus, "SAT");
    expect(body.records.find((r: { ticketId: string }) => r.ticketId === sat.ticketNumber)).toEqual({
      ticketId: sat.ticketNumber,
      name: "Marcus Vale",
      email: EMAILS.marcus,
      phone: (await db.member.findUniqueOrThrow({ where: { id: sat.memberId } })).mobile,
      type: "SAT",
      typeName: "Saturday Access",
      tier: "Ultra Black",
      status: expect.any(String),
      scanned: 0,
      timeScanned: null,
    });
  });

  it("gets one ticket, any case, and 404 for an unknown one", async () => {
    const sat = await ticketOf(EMAILS.marcus, "SAT");
    const res = await oneRoute(req("/api/scan/tickets/" + sat.ticketNumber.toLowerCase()), params(sat.ticketNumber.toLowerCase()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ticketId: sat.ticketNumber, scanned: 0 });
    const missing = await oneRoute(req("/api/scan/tickets/AD26-NOPE"), params("AD26-NOPE"));
    expect(missing.status).toBe(404);
  });

  it("marks a ticket scanned once, logged like the staff scanner, and undoes it", async () => {
    const sat = await ticketOf(EMAILS.marcus, "SAT");
    const first = await put(sat.ticketNumber, { scanned: 1 });
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a).toEqual({ ticketId: sat.ticketNumber, scanned: 1, timeScanned: expect.any(String) });

    const again = await (await put(sat.ticketNumber, { scanned: "1" })).json();
    expect(again).toEqual({ ticketId: sat.ticketNumber, scanned: 1, timeScanned: a.timeScanned, alreadyScanned: true });
    expect(await db.ticketCheckIn.count({ where: { ticketId: sat.id } })).toBe(1);

    const log = await db.ticketScanLog.findFirstOrThrow({ where: { ticketId: sat.id, action: "CHECK_IN" }, include: { staff: true } });
    expect(log).toMatchObject({ result: "VALID", method: "MANUAL", deviceInfo: "door-scanner/1" });
    expect(log.staff).toMatchObject({ email: SCAN_API_USER_EMAIL, status: "DISABLED", passwordHash: null, role: "CHECK_IN_STAFF" });

    const record = await (await oneRoute(req("/api/scan/tickets/" + sat.ticketNumber), params(sat.ticketNumber))).json();
    expect(record).toMatchObject({ scanned: 1, timeScanned: a.timeScanned });

    const undo = await (await put(sat.ticketNumber, { scanned: 0 })).json();
    expect(undo).toEqual({ ticketId: sat.ticketNumber, scanned: 0, timeScanned: null });
    expect(await db.ticketCheckIn.count({ where: { ticketId: sat.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "scan_api.unscanned", entityId: sat.id } })).toBe(1);
  });

  it("uses the staff scanner's entry key, so a daily ticket counts as used for the day", async () => {
    const park = await ticketOf(EMAILS.marcus, "PARK");
    expect((await put(park.ticketNumber, { scanned: true })).status).toBe(200);
    const checkIn = await db.ticketCheckIn.findFirstOrThrow({ where: { ticketId: park.id } });
    expect(checkIn.entryKey).toMatch(/^day:\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses revoked and suspended tickets and bad bodies", async () => {
    const sun = await ticketOf(EMAILS.sophia, "SUN");
    try {
      await db.ticket.update({ where: { id: sun.id }, data: { status: "REVOKED" } });
      const revoked = await put(sun.ticketNumber, { scanned: 1 });
      expect(revoked.status).toBe(409);
      expect(await revoked.json()).toEqual({ error: "This ticket has been revoked." });
      await db.ticket.update({ where: { id: sun.id }, data: { status: "SUSPENDED" } });
      expect((await put(sun.ticketNumber, { scanned: 1 })).status).toBe(409);
    } finally {
      await db.ticket.update({ where: { id: sun.id }, data: { status: sun.status } });
    }
    expect(await db.ticketCheckIn.count({ where: { ticketId: sun.id } })).toBe(0);
    expect((await put(sun.ticketNumber, { scanned: 2 })).status).toBe(422);
    expect((await put(sun.ticketNumber, {})).status).toBe(422);
    expect((await put(sun.ticketNumber, { scanned: 1 }, "wrong")).status).toBe(401);
  });
});
