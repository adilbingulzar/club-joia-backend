import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addMessage, createRequest, getRequest, listMyRequests, listRequestsStaff, updateStatus } from "@/services/concierge.service";
import { createNotification, listMyNotifications } from "@/services/notification.service";
import { recordAudit } from "@/services/audit.service";
import { actorFor, EMAILS } from "../support/actors";

describe("concierge submission", () => {
  it("member submits, staff replies with a private note, member sees only the public reply", async () => {
    const [sophia, concierge, alex, scanner] = await Promise.all([
      actorFor(EMAILS.sophia),
      actorFor(EMAILS.concierge),
      actorFor(EMAILS.alex),
      actorFor(EMAILS.scanner),
    ]);
    const req = await createRequest(sophia, { category: "DINING", subject: "Table for four", description: "Saturday dinner please", numberOfPeople: 4 });
    expect(req.reference).toMatch(/^JC-/);
    expect((await listMyRequests(sophia)).some((r) => r.id === req.id)).toBe(true);

    const staffList = await listRequestsStaff(concierge, { status: "NEW" });
    expect(staffList.rows.some((r) => r.id === req.id)).toBe(true);

    await addMessage(concierge, req.id, { message: "Booked at 20:30.", internalNote: false });
    await addMessage(concierge, req.id, { message: "VIP regular — comp dessert", internalNote: true });
    await updateStatus(concierge, req.id, "CONFIRMED");

    const memberView = await getRequest(sophia, req.id);
    expect(memberView.status).toBe("CONFIRMED");
    expect(memberView.messages.some((m) => m.message.includes("comp dessert"))).toBe(false);
    expect(memberView.messages.some((m) => m.message === "Booked at 20:30.")).toBe(true);
    const staffView = await getRequest(concierge, req.id);
    expect(staffView.messages.some((m) => m.internalNote)).toBe(true);

    // Other members and check-in staff cannot see it.
    await expect(getRequest(alex, req.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRequest(scanner, req.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listRequestsStaff(scanner)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Confirmation notified the member.
    const inbox = await listMyNotifications(sophia);
    expect(inbox.some((n) => n.body.includes("confirmed"))).toBe(true);
  });

  it("members cannot post internal notes", async () => {
    const sophia = await actorFor(EMAILS.sophia);
    const req = (await listMyRequests(sophia))[0];
    await expect(addMessage(sophia, req.id, { message: "x", internalNote: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("notifications", () => {
  it("admin broadcast reaches every active member's notification centre", async () => {
    const [admin, marcus, concierge] = await Promise.all([actorFor(EMAILS.admin), actorFor(EMAILS.marcus), actorFor(EMAILS.concierge)]);
    const n = await createNotification(admin, { title: "VIP Yacht Lunch", body: "Begins at 12:30.", type: "PROGRAMME", targetType: "ALL_MEMBERS", channels: ["IN_APP", "WEB_PUSH"] });
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("SENT");
    expect((await listMyNotifications(marcus)).some((x) => x.title === "VIP Yacht Lunch")).toBe(true);
    // Push isn't configured in tests: recorded honestly as skipped.
    expect(await db.notificationRecipient.count({ where: { notificationId: n.id, deliveryChannel: "WEB_PUSH", deliveryStatus: "SENT" } })).toBe(0);
    await expect(createNotification(concierge, { title: "x", body: "y", type: "ANNOUNCEMENT", targetType: "ALL_MEMBERS", channels: ["IN_APP"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("schedules future notifications without delivering them", async () => {
    const admin = await actorFor(EMAILS.admin);
    const tier = await db.membershipTier.findUniqueOrThrow({ where: { slug: "pearly-white" } });
    const n = await createNotification(admin, {
      title: "Later", body: "Soon", type: "ANNOUNCEMENT", targetType: "TIER", targetId: tier.id, channels: ["IN_APP"], scheduledAt: new Date(Date.now() + 3600_000),
    });
    expect(n.status).toBe("SCHEDULED");
    expect(await db.notificationRecipient.count({ where: { notificationId: n.id } })).toBe(0);
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const admin = await actorFor(EMAILS.admin);
    await recordAudit(admin, { action: "test.entry", entityType: "test" });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "test.entry" } });
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("test.entry");
  });

  it("redacts secrets from audit snapshots", async () => {
    const admin = await actorFor(EMAILS.admin);
    await recordAudit(admin, { action: "test.redact", entityType: "test", after: { passwordHash: "abc", name: "ok" } });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "test.redact" } });
    expect(row.afterData).toEqual({ passwordHash: "[redacted]", name: "ok" });
  });
});
