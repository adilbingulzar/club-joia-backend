/**
 * CLUB JOIA 300 — DEVELOPMENT SEED DATA
 *
 * ⚠️  Local development / staging only. Passwords below are FAKE, public and for local use.
 *     The script refuses to run against NODE_ENV=production unless SEED_ALLOW_PRODUCTION=true,
 *     and even then you must change every seeded password immediately.
 *
 * The programme, tier privileges, ticket windows and event information are EDITABLE SAMPLE
 * DATA (programme items are flagged `isSample`), not the confirmed Abu Dhabi 2026 schedule.
 *
 * Idempotent: re-running upserts reference data and skips anything that already exists.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { EntryPolicy, ProgramCategory, ProgramVisibility, Role } from "../src/generated/prisma/enums";
import { humanCode, randomToken } from "../src/lib/crypto";
import { createMySqlAdapter } from "../src/lib/db-adapter";
import { zonedToUtc } from "../src/lib/time";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
  console.error("Refusing to seed a production database. Set SEED_ALLOW_PRODUCTION=true if you really mean it.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: createMySqlAdapter(process.env.DATABASE_URL) });

export const DEV_PASSWORDS = {
  member: "JoiaDev!2026-member", // LOCAL DEV ONLY
  staff: "JoiaDev!2026-staff", // LOCAL DEV ONLY
};

const TZ = "Asia/Dubai";
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);

async function main() {
  console.log("Seeding CLUB JOIA 300 development data…");

  // ── Chapter ──────────────────────────────────────────────────────────────
  const chapter = await db.chapter.upsert({
    where: { slug: "abu-dhabi" },
    update: {},
    create: { slug: "abu-dhabi", name: "Abu Dhabi", city: "Abu Dhabi", country: "United Arab Emirates", timezone: TZ },
  });

  // ── Entitlement catalogue ────────────────────────────────────────────────
  const entitlements: { code: string; name: string; description: string; category: string; valueType: "BOOLEAN" | "INTEGER" | "TEXT" }[] = [
    { code: "event_access", name: "Event access", description: "Access to CLUB JOIA 300 event hospitality.", category: "ACCESS", valueType: "BOOLEAN" },
    { code: "vip_deck_access", name: "VIP Deck", description: "Access to the VIP deck.", category: "ACCESS", valueType: "BOOLEAN" },
    { code: "priority_checkin", name: "Priority check-in", description: "Dedicated arrival lane.", category: "HOSPITALITY", valueType: "BOOLEAN" },
    { code: "premium_parking", name: "Premium parking", description: "Reserved parking close to the venue.", category: "ACCESS", valueType: "BOOLEAN" },
    { code: "concierge_level", name: "Concierge service", description: "Level of personal concierge support.", category: "SERVICE", valueType: "TEXT" },
    { code: "guest_passes", name: "Guest passes", description: "Number of guests the member may bring.", category: "GUEST", valueType: "INTEGER" },
    { code: "afterparty_access", name: "After-race celebration", description: "Access to the Sunday after-race celebration.", category: "ACCESS", valueType: "BOOLEAN" },
  ];
  const entByCode: Record<string, string> = {};
  for (const e of entitlements) {
    const row = await db.entitlement.upsert({ where: { code: e.code }, update: {}, create: e });
    entByCode[e.code] = row.id;
  }

  // ── Tiers (privileges below are SAMPLE configuration — edit in Admin → Memberships) ──
  const tiers = [
    {
      slug: "ruby-red", name: "RUBY RED", displayName: "Ruby Red", color: "#EF233C", cardTheme: "ruby", sortOrder: 10,
      description: "The signature CLUB JOIA 300 membership.",
      grants: { event_access: true, concierge_level: "standard", guest_passes: 0 },
    },
    {
      slug: "pearly-white", name: "PEARLY WHITE", displayName: "Pearly White", color: "#F5F3EE", cardTheme: "pearl", sortOrder: 20,
      description: "Elevated access with the VIP deck and priority arrival.",
      grants: { event_access: true, vip_deck_access: true, priority_checkin: true, concierge_level: "priority", guest_passes: 1, afterparty_access: true },
    },
    {
      slug: "ultra-black", name: "ULTRA BLACK", displayName: "Ultra Black", color: "#0B0B0C", cardTheme: "black", sortOrder: 30,
      description: "The highest level of CLUB JOIA 300 membership.",
      grants: { event_access: true, vip_deck_access: true, priority_checkin: true, premium_parking: true, concierge_level: "dedicated", guest_passes: 2, afterparty_access: true },
    },
  ] as const;
  const tierBySlug: Record<string, string> = {};
  for (const { grants, ...t } of tiers) {
    const tier = await db.membershipTier.upsert({ where: { slug: t.slug }, update: {}, create: { ...t, metadata: { sample: true } } });
    tierBySlug[t.slug] = tier.id;
    for (const [code, value] of Object.entries(grants)) {
      await db.tierEntitlement.upsert({
        where: { tierId_entitlementId: { tierId: tier.id, entitlementId: entByCode[code] } },
        update: {},
        create: { tierId: tier.id, entitlementId: entByCode[code], value: value as Prisma.InputJsonValue },
      });
    }
  }

  // ── Event ────────────────────────────────────────────────────────────────
  const event = await db.event.upsert({
    where: { slug: "abu-dhabi-2026" },
    update: {},
    create: {
      slug: "abu-dhabi-2026",
      chapterId: chapter.id,
      name: "Abu Dhabi Grand Prix Weekend 2026",
      city: "Abu Dhabi",
      country: "United Arab Emirates",
      venue: "Yas Marina",
      timezone: TZ,
      startDate: d("2026-12-04"),
      endDate: d("2026-12-06"),
      status: "PUBLISHED",
      description:
        "Three days of Grand Prix hospitality on the water at Yas Marina — racing, long lunches, sunset on deck and celebrations long after the chequered flag.",
      metadata: {
        sample: true,
        tagline: "Grand Prix Weekend",
        ticketPrefix: "AD26",
        supportEmail: "concierge@clubjoia.example",
        supportPhone: "+971 00 000 0000",
        dressCode: "Smart resort by day, elegant evening wear after sunset. (Sample — to be confirmed.)",
        infoSections: [
          { title: "Arrival", body: "Arrive via the Yas Marina hospitality entrance. Have your ticket open for scanning. (Sample information.)" },
          { title: "Transport", body: "Concierge can arrange transfers from Abu Dhabi and Dubai hotels. Submit a Transport request. (Sample information.)" },
          { title: "Weather", body: "Expect warm days around 27°C and cooler evenings. (Sample information.)" },
        ],
      },
    },
  });

  // ── Access zones ─────────────────────────────────────────────────────────
  const zoneDefs = [
    { code: "MAIN", name: "Main Hospitality", description: "CLUB JOIA 300 yacht hospitality", requiredEntitlementCode: null, sortOrder: 10 },
    { code: "VIP_DECK", name: "VIP Deck", description: "Upper deck", requiredEntitlementCode: "vip_deck_access", sortOrder: 20 },
    { code: "PARKING", name: "Premium Parking", description: "Reserved parking", requiredEntitlementCode: "premium_parking", sortOrder: 30 },
    { code: "AFTER_PARTY", name: "After-Race Celebration", description: "Sunday night", requiredEntitlementCode: "afterparty_access", sortOrder: 40 },
  ];
  const zone: Record<string, string> = {};
  for (const z of zoneDefs) {
    const row = await db.accessZone.upsert({ where: { eventId_code: { eventId: event.id, code: z.code } }, update: {}, create: { ...z, eventId: event.id } });
    zone[z.code] = row.id;
  }

  // ── Ticket types (validity windows are sample values) ───────────────────
  const typeDefs: { code: string; name: string; description: string; from: Date; until: Date; policy: EntryPolicy; zones: string[]; sortOrder: number }[] = [
    { code: "FRI", name: "Friday Access", description: "Friday 4 December hospitality", from: at("2026-12-04", "09:00"), until: at("2026-12-05", "03:00"), policy: "MULTI_ENTRY", zones: ["MAIN", "VIP_DECK"], sortOrder: 10 },
    { code: "SAT", name: "Saturday Access", description: "Saturday 5 December hospitality", from: at("2026-12-05", "09:00"), until: at("2026-12-06", "03:00"), policy: "MULTI_ENTRY", zones: ["MAIN", "VIP_DECK"], sortOrder: 20 },
    { code: "SUN", name: "Sunday Access", description: "Sunday 6 December — race day", from: at("2026-12-06", "09:00"), until: at("2026-12-07", "03:00"), policy: "MULTI_ENTRY", zones: ["MAIN", "VIP_DECK"], sortOrder: 30 },
    { code: "PARK", name: "Premium Parking", description: "Weekend parking, one entry per day", from: at("2026-12-04", "07:00"), until: at("2026-12-07", "03:00"), policy: "DAILY_ENTRY", zones: ["PARKING"], sortOrder: 40 },
    { code: "AFTER", name: "After-Race Celebration", description: "Sunday night celebration", from: at("2026-12-06", "20:00"), until: at("2026-12-07", "04:00"), policy: "SINGLE_ENTRY", zones: ["AFTER_PARTY"], sortOrder: 50 },
  ];
  const ticketType: Record<string, { id: string; from: Date; until: Date }> = {};
  for (const t of typeDefs) {
    const row = await db.ticketType.upsert({
      where: { eventId_code: { eventId: event.id, code: t.code } },
      update: {},
      create: { eventId: event.id, code: t.code, name: t.name, description: t.description, validFrom: t.from, validUntil: t.until, entryPolicy: t.policy, sortOrder: t.sortOrder, metadata: { sample: true } },
    });
    ticketType[t.code] = { id: row.id, from: row.validFrom, until: row.validUntil };
    for (const zc of t.zones) {
      await db.ticketTypeZone.upsert({
        where: { ticketTypeId_zoneId: { ticketTypeId: row.id, zoneId: zone[zc] } },
        update: {},
        create: { ticketTypeId: row.id, zoneId: zone[zc] },
      });
    }
  }

  // ── Programme (EDITABLE SAMPLE) ──────────────────────────────────────────
  const existingItems = await db.eventProgramItem.count({ where: { eventId: event.id } });
  if (existingItems === 0) {
    type P = [string, string | null, string, string, ProgramCategory, string?, ProgramVisibility?, string?];
    const programme: Record<string, P[]> = {
      "2026-12-04": [
        ["11:00", "12:00", "Guest arrival", "Main Hospitality", "ARRIVAL", "Welcome aboard. Check in at the hospitality entrance."],
        ["12:00", "12:30", "Welcome hospitality", "Main Deck", "HOSPITALITY", "Champagne and introductions from the CLUB JOIA team."],
        ["12:30", "14:30", "Yacht lunch", "Main Deck", "FOOD", "A long Mediterranean lunch on the water."],
        ["14:30", "16:30", "Track activity — practice", "Trackside View", "RACING", "Free practice viewing from the deck."],
        ["17:00", "18:30", "Sunset drinks", "VIP Deck", "HOSPITALITY", "Sunset over Yas Marina.", "RESTRICTED", "vip_deck_access"],
        ["19:30", "22:00", "Dinner", "Main Deck", "FOOD", "Chef's seasonal menu."],
        ["22:00", "01:00", "DJ & entertainment", "Main Deck", "ENTERTAINMENT", "Resident DJ into the night."],
      ],
      "2026-12-05": [
        ["11:00", "12:00", "Arrival", "Main Hospitality", "ARRIVAL", "Doors open for day two."],
        ["12:00", "14:00", "Track programme", "Trackside View", "RACING", "Final practice and support races."],
        ["13:00", "15:00", "Lunch", "Main Deck", "FOOD", "Seafood lunch service."],
        ["17:00", "18:30", "Qualifying viewing", "Main Deck", "RACING", "Qualifying live on deck and screens."],
        ["18:30", "19:30", "Sunset hospitality", "VIP Deck", "HOSPITALITY", "Golden hour on the upper deck.", "RESTRICTED", "vip_deck_access"],
        ["20:00", "22:30", "Dinner", "Main Deck", "FOOD", "Grand Prix Saturday dinner."],
        ["22:30", "01:30", "Entertainment", "Main Deck", "ENTERTAINMENT", "Live performance and DJ."],
      ],
      "2026-12-06": [
        ["11:00", "12:00", "Arrival", "Main Hospitality", "ARRIVAL", "Race day welcome."],
        ["12:00", "15:00", "Race day brunch", "Main Deck", "FOOD", "Brunch through the build-up."],
        ["15:00", "17:00", "Race build-up", "Trackside View", "RACING", "Drivers' parade and grid coverage."],
        ["17:00", "19:00", "Abu Dhabi Grand Prix", "Main Deck", "RACING", "Lights out — the season finale."],
        ["19:00", "19:45", "Podium celebration", "Main Deck", "HOSPITALITY", "Champagne as the podium is crowned."],
        ["20:00", "22:00", "Dinner", "Main Deck", "FOOD", "Season-finale dinner."],
        ["22:00", "03:00", "After-race celebration", "After-Race Venue", "AFTER_PARTY", "The CLUB JOIA 300 closing celebration.", "RESTRICTED", "afterparty_access"],
      ],
    };
    for (const [date, items] of Object.entries(programme)) {
      let order = 10;
      for (const [start, end, title, location, category, description, visibility, ent] of items) {
        await db.eventProgramItem.create({
          data: {
            eventId: event.id, date: d(date), startTime: start, endTime: end, title, location, category,
            description: description ?? null, visibility: visibility ?? "MEMBERS", requiredEntitlementCode: ent ?? null,
            sortOrder: order, isSample: true, subtitle: null,
          },
        });
        order += 10;
      }
    }
  }

  // ── Accounts ─────────────────────────────────────────────────────────────
  const memberHash = await hash(DEV_PASSWORDS.member);
  const staffHash = await hash(DEV_PASSWORDS.staff);

  const staff: { email: string; name: string; role: Role }[] = [
    { email: "admin@joia.test", name: "Joia Admin", role: "SUPER_ADMIN" },
    { email: "manager@joia.test", name: "Operations Manager", role: "ADMIN" },
    { email: "concierge@joia.test", name: "Layla Concierge", role: "CONCIERGE" },
    { email: "scanner@joia.test", name: "Gate Scanner", role: "CHECK_IN_STAFF" },
  ];
  const staffIds: Record<string, string> = {};
  for (const s of staff) {
    const u = await db.user.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, passwordHash: staffHash, status: "ACTIVE", emailVerifiedAt: new Date(), passwordChangedAt: new Date() },
    });
    staffIds[s.email] = u.id;
  }

  const members = [
    { email: "alex.carter@joia.test", first: "Alex", last: "Carter", tier: "ruby-red", number: "CJ300-0001", city: "London", country: "United Kingdom", company: "Carter Capital", tickets: ["FRI", "SAT", "SUN"] },
    { email: "sophia.laurent@joia.test", first: "Sophia", last: "Laurent", tier: "pearly-white", number: "CJ300-0002", city: "Monaco", country: "Monaco", company: "Maison Laurent", tickets: ["FRI", "SAT", "SUN", "AFTER"] },
    { email: "marcus.vale@joia.test", first: "Marcus", last: "Vale", tier: "ultra-black", number: "CJ300-0003", city: "Dubai", country: "United Arab Emirates", company: "Vale Maritime", tickets: ["FRI", "SAT", "SUN", "PARK", "AFTER"] },
  ];
  const memberIds: Record<string, string> = {};
  for (const m of members) {
    const user = await db.user.upsert({
      where: { email: m.email },
      update: {},
      create: {
        email: m.email, name: `${m.first} ${m.last}`, role: "MEMBER", status: "ACTIVE",
        passwordHash: memberHash, emailVerifiedAt: new Date(), passwordChangedAt: new Date(),
      },
    });
    const member = await db.member.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id, membershipNumber: m.number, firstName: m.first, lastName: m.last,
        city: m.city, country: m.country, company: m.company, memberSince: new Date("2026-09-01T00:00:00Z"),
        preferences: { notifications: { push: true, programmeUpdates: true, conciergeUpdates: true } },
      },
    });
    memberIds[m.email] = member.id;
    if ((await db.membership.count({ where: { memberId: member.id } })) === 0) {
      await db.membership.create({
        data: {
          memberId: member.id, tierId: tierBySlug[m.tier], membershipNumber: m.number, status: "ACTIVE",
          startDate: d("2026-09-01"), endDate: d("2026-12-31"), issueDate: new Date("2026-09-01T00:00:00Z"), homeChapterId: chapter.id,
        },
      });
      await db.consentRecord.createMany({
        data: (["TERMS", "PRIVACY_POLICY"] as const).map((type) => ({ userId: user.id, type, version: "seed", granted: true })),
      });
    }
    for (const code of m.tickets) {
      const tt = ticketType[code];
      const has = await db.ticket.findFirst({ where: { memberId: member.id, ticketTypeId: tt.id } });
      if (has) continue;
      const ticket = await db.ticket.create({
        data: {
          eventId: event.id, ticketTypeId: tt.id, memberId: member.id, ticketNumber: `AD26-${code}-${humanCode(6)}`,
          validFrom: tt.from, validUntil: tt.until, issuedById: staffIds["admin@joia.test"],
        },
      });
      await db.ticketCredential.create({ data: { ticketId: ticket.id, credentialRef: randomToken(16), version: 1 } });
    }
  }

  // ── Sample concierge request ─────────────────────────────────────────────
  const alexId = memberIds["alex.carter@joia.test"];
  if ((await db.conciergeRequest.count({ where: { memberId: alexId } })) === 0) {
    const req = await db.conciergeRequest.create({
      data: {
        reference: `JC-${humanCode(6)}`, memberId: alexId, eventId: event.id, category: "TRANSPORT",
        subject: "Airport transfer on arrival", description: "Landing at AUH on Thursday 3 December at 18:40, two passengers with luggage.",
        preferredDate: d("2026-12-03"), preferredTime: "18:40", numberOfPeople: 2, status: "IN_PROGRESS",
        assignedToId: staffIds["concierge@joia.test"],
      },
    });
    await db.conciergeRequestMessage.createMany({
      data: [
        { requestId: req.id, senderId: staffIds["concierge@joia.test"], senderType: "STAFF", message: "Thank you, Mr Carter. We are arranging a Mercedes S-Class with meet & greet. Confirmation shortly." },
        { requestId: req.id, senderId: staffIds["concierge@joia.test"], senderType: "STAFF", message: "Preferred driver requested from partner — awaiting reply.", internalNote: true },
      ],
    });
  }

  // ── Welcome notification ─────────────────────────────────────────────────
  if ((await db.notification.count()) === 0) {
    const n = await db.notification.create({
      data: {
        title: "Welcome to CLUB JOIA 300",
        body: "Your membership card and Abu Dhabi credentials are ready in the app.",
        type: "ANNOUNCEMENT", targetType: "ALL_MEMBERS", channels: ["IN_APP"], status: "SENT", sentAt: new Date(),
        createdById: staffIds["admin@joia.test"], url: "/card",
      },
    });
    await db.notificationRecipient.createMany({
      data: Object.values(memberIds).map((memberId) => ({ notificationId: n.id, memberId, deliveryChannel: "IN_APP" as const, deliveryStatus: "SENT" as const, sentAt: new Date() })),
    });
  }

  console.log(`
Seed complete. LOCAL DEVELOPMENT CREDENTIALS (fake — never use in production):
  Members  (password: ${DEV_PASSWORDS.member})
    alex.carter@joia.test      Ruby Red
    sophia.laurent@joia.test   Pearly White
    marcus.vale@joia.test      Ultra Black
  Staff    (password: ${DEV_PASSWORDS.staff})
    admin@joia.test            Super admin
    manager@joia.test          Admin
    concierge@joia.test        Concierge
    scanner@joia.test          Check-in staff
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
