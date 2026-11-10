import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEvent } from "@/services/event.service";
import { assignRequest, createRequest, getRequest } from "@/services/concierge.service";
import { issueTicket, issueTicketsBulk } from "@/services/ticket.service";
import { updateStaffContact } from "@/services/staff.service";
import { createProgrammeItem } from "@/services/programme.service";
import { actorFor, EMAILS } from "../support/actors";

const baseEvent = {
  venue: "Port Hercule",
  city: "Monaco",
  country: "Monaco",
  timezone: "Europe/Monaco",
  description: null,
  info: { tagline: "Grand Prix Weekend" },
};

describe("event creation", () => {
  it("super admin creates a draft event cloned from Abu Dhabi, with zones, shifted ticket windows and a draft programme", async () => {
    const admin = await actorFor(EMAILS.admin);
    const source = await db.event.findUniqueOrThrow({ where: { slug: "abu-dhabi-2026" }, include: { ticketTypes: true, zones: true } });
    const ev = await createEvent(admin, {
      ...baseEvent, name: "Monaco Grand Prix 2027", startDate: "2027-06-04", endDate: "2027-06-06",
      cloneFromEventId: source.id, cloneProgramme: true,
    });
    expect(ev.status).toBe("DRAFT");
    expect(ev.slug).toBe("monaco-grand-prix-2027");
    expect((ev.metadata as { ticketPrefix?: string }).ticketPrefix).toBe("MONA");

    const full = await db.event.findUniqueOrThrow({ where: { id: ev.id }, include: { zones: true, ticketTypes: { include: { zones: true } }, programItems: true } });
    expect(full.zones.map((z) => z.code).sort()).toEqual(source.zones.map((z) => z.code).sort());
    expect(full.ticketTypes).toHaveLength(source.ticketTypes.length);
    const fri = full.ticketTypes.find((t) => t.code === "FRI")!;
    const srcFri = source.ticketTypes.find((t) => t.code === "FRI")!;
    // Same local schedule, shifted by the distance between the start dates.
    expect(fri.validFrom.getTime() - srcFri.validFrom.getTime()).toBe(Date.parse("2027-06-04") - Date.parse("2026-12-04"));
    expect(fri.zones.length).toBeGreaterThan(0);
    expect(full.programItems.length).toBeGreaterThan(0);
    expect(full.programItems.every((i) => i.visibility === "DRAFT")).toBe(true);

    const audit = await db.auditLog.findFirst({ where: { action: "event.create", entityId: ev.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects duplicate slugs, bad dates and non-super-admins", async () => {
    const [admin, manager] = await Promise.all([actorFor(EMAILS.admin), actorFor(EMAILS.manager)]);
    await expect(createEvent(admin, { ...baseEvent, name: "Monaco Grand Prix 2027", startDate: "2027-06-04", endDate: "2027-06-06" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createEvent(admin, { ...baseEvent, name: "Backwards", startDate: "2027-06-06", endDate: "2027-06-04" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createEvent(admin, { ...baseEvent, name: "Bad zone", timezone: "Mars/Olympus", startDate: "2027-06-04", endDate: "2027-06-06" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createEvent(manager, { ...baseEvent, name: "Not allowed", startDate: "2027-06-04", endDate: "2027-06-06" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("programme items belong to their own event and carry an icon", async () => {
    const admin = await actorFor(EMAILS.admin);
    const ev = await db.event.findUniqueOrThrow({ where: { slug: "monaco-grand-prix-2027" } });
    const item = await createProgrammeItem(admin, ev.id, {
      date: "2027-06-05", startTime: "12:00", endTime: null, title: "Harbour lunch", subtitle: null, description: null, location: null,
      category: "FOOD", icon: "yacht", visibility: "DRAFT", requiredEntitlementCode: null, capacity: null,
    });
    expect(item.eventId).toBe(ev.id);
    expect(item.icon).toBe("yacht");
    // Dates outside the event are refused.
    await expect(
      createProgrammeItem(admin, ev.id, { date: "2026-12-05", startTime: "12:00", endTime: null, title: "Wrong event day", subtitle: null, description: null, location: null, category: "FOOD", icon: null, visibility: "DRAFT", requiredEntitlementCode: null, capacity: null }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("tickets are issued within an event", () => {
  it("refuses a ticket type that belongs to a different event", async () => {
    const manager = await actorFor(EMAILS.manager);
    const sophia = await db.member.findFirstOrThrow({ where: { user: { email: EMAILS.sophia } } });
    const monaco = await db.event.findUniqueOrThrow({ where: { slug: "monaco-grand-prix-2027" } });
    const adFri = await db.ticketType.findFirstOrThrow({ where: { code: "FRI", event: { slug: "abu-dhabi-2026" } } });
    await expect(issueTicket(manager, { memberId: sophia.id, ticketTypeId: adFri.id, eventId: monaco.id })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(issueTicketsBulk(manager, { ticketTypeId: adFri.id, eventId: monaco.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("issues with the event's own ticket prefix", async () => {
    const manager = await actorFor(EMAILS.manager);
    const sophia = await db.member.findFirstOrThrow({ where: { user: { email: EMAILS.sophia } } });
    const monaco = await db.event.findUniqueOrThrow({ where: { slug: "monaco-grand-prix-2027" } });
    const sat = await db.ticketType.findFirstOrThrow({ where: { code: "SAT", eventId: monaco.id } });
    const t = await issueTicket(manager, { memberId: sophia.id, ticketTypeId: sat.id, eventId: monaco.id, notify: false });
    expect(t.ticketNumber).toMatch(/^MONA-SAT-/);
    expect(t.eventId).toBe(monaco.id);
  });
});

describe("staff alerts for concierge", () => {
  it("a new request records which responsible staff were alerted (staff-only note)", async () => {
    const [admin, concierge, sophia] = await Promise.all([actorFor(EMAILS.admin), actorFor(EMAILS.concierge), actorFor(EMAILS.sophia)]);
    const conciergeUser = await db.user.findUniqueOrThrow({ where: { email: EMAILS.concierge } });
    await updateStaffContact(admin, conciergeUser.id, { name: conciergeUser.name, whatsappNumber: "+971500000001", alertByEmail: true, alertByWhatsapp: true, conciergeCategories: ["TRANSPORT"] });

    const req = await createRequest(sophia, { category: "TRANSPORT", subject: "Airport pickup", description: "Arriving Friday 10:00" });
    const staffView = await getRequest(concierge, req.id);
    const note = staffView.messages.find((m) => m.internalNote && m.message.startsWith("Team alerted"));
    expect(note?.message).toContain(conciergeUser.name);
    // Local test env uses the console drivers: nothing is delivered and the note says so.
    expect(note?.message).toContain("email (not configured)");
    expect(note?.message).toContain("WhatsApp (not configured)");

    // The member never sees alert notes.
    const memberView = await getRequest(sophia, req.id);
    expect(memberView.messages.some((m) => m.message.includes("alerted"))).toBe(false);
  });

  it("a request nobody covers escalates to admins", async () => {
    const [concierge, sophia] = await Promise.all([actorFor(EMAILS.concierge), actorFor(EMAILS.sophia)]);
    const req = await createRequest(sophia, { category: "YACHT", subject: "Yacht day", description: "Sunday morning" });
    const note = (await getRequest(concierge, req.id)).messages.find((m) => m.internalNote && m.message.startsWith("Team alerted"));
    const conciergeUser = await db.user.findUniqueOrThrow({ where: { email: EMAILS.concierge } });
    expect(note?.message).not.toContain(conciergeUser.name); // concierge now only covers TRANSPORT
    const manager = await db.user.findUniqueOrThrow({ where: { email: EMAILS.manager } });
    expect(note?.message).toContain(manager.name);
  });

  it("assigning a request alerts the assignee, but not when assigning to yourself", async () => {
    const [manager, concierge, sophia] = await Promise.all([actorFor(EMAILS.manager), actorFor(EMAILS.concierge), actorFor(EMAILS.sophia)]);
    const req = await createRequest(sophia, { category: "DINING", subject: "Dinner", description: "Saturday" });
    await assignRequest(manager, req.id, concierge.userId);
    let notes = (await getRequest(concierge, req.id)).messages.filter((m) => m.message.startsWith("Assignment alert"));
    expect(notes).toHaveLength(1);
    await assignRequest(concierge, req.id, null);
    await assignRequest(concierge, req.id, concierge.userId);
    notes = (await getRequest(concierge, req.id)).messages.filter((m) => m.message.startsWith("Assignment alert"));
    expect(notes).toHaveLength(1);
  });

  it("only super admins edit staff contact details", async () => {
    const manager = await actorFor(EMAILS.manager);
    await expect(updateStaffContact(manager, manager.userId, { name: "x x", whatsappNumber: null, alertByEmail: true, alertByWhatsapp: false, conciergeCategories: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
