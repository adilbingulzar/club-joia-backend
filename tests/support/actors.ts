import { db } from "@/lib/db";
import type { Actor } from "@/services/context";

/** Build a service Actor for a seeded user (bypasses cookies, exactly like a resolved session). */
export async function actorFor(email: string): Promise<Actor> {
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { member: true } });
  return { userId: user.id, role: user.role, memberId: user.member?.id ?? null, ipAddress: "127.0.0.1", userAgent: "vitest" };
}

export const EMAILS = {
  alex: "alex.carter@joia.test", // Ruby Red
  sophia: "sophia.laurent@joia.test", // Pearly White
  marcus: "marcus.vale@joia.test", // Ultra Black
  admin: "admin@joia.test",
  manager: "manager@joia.test",
  concierge: "concierge@joia.test",
  scanner: "scanner@joia.test",
};

/** Friday 4 Dec 2026, 14:00 in Abu Dhabi — inside the seeded Friday ticket window. */
export const FRIDAY_AFTERNOON = new Date("2026-12-04T10:00:00Z");
/** Sunday 6 Dec 2026, 22:00 Abu Dhabi — after-party window. */
export const SUNDAY_NIGHT = new Date("2026-12-06T18:00:00Z");

export async function zoneId(code: string) {
  return (await db.accessZone.findFirstOrThrow({ where: { code } })).id;
}

export async function ticketOf(email: string, typeCode: string) {
  return db.ticket.findFirstOrThrow({ where: { member: { user: { email } }, ticketType: { code: typeCode } } });
}
