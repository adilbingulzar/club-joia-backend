import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addressAllowed, forgetIpAllowlist, parseEntry } from "@/lib/security/ip-allowlist-store";
import { parseAllowlist } from "@/lib/security/ip-allowlist";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * IpAllowlistService — the addresses allowed into this site, for super admins (/admin/ip-allowlist).
 * How the proxy applies them: src/lib/security/ip-allowlist-store.ts.
 *
 * A change that would shut out the super admin making it is refused, so the panel can't lock its
 * own user out (IP_ALLOWLIST in .env is the way back in for everything else).
 */

export async function listIpAllowlist(actor: Actor) {
  requirePermission(actor, "settings:manage");
  const entries = await db.ipAllowlistEntry.findMany({ orderBy: { createdAt: "asc" } });
  const by = await db.user.findMany({ where: { id: { in: entries.map((e) => e.createdById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const names = new Map(by.map((u) => [u.id, u.name]));
  return {
    entries: entries.map((e) => ({ ...e, createdBy: e.createdById ? (names.get(e.createdById) ?? null) : null })),
  };
}

/** Refuses the change when the list it leaves would shut out the actor's own address. */
function keepsActorIn(actor: Actor, addresses: string[]) {
  const ip = actor.ipAddress ?? "";
  if (addressAllowed(ip, parseAllowlist(addresses.join(" ")))) return;
  throw new AppError(
    "INVALID_STATE",
    `This would block your own IP (${ip || "unknown"}) and lock you out. Add your IP first.`,
  );
}

export async function addIpAllowlistEntry(actor: Actor, input: { address: string; label?: string }) {
  requirePermission(actor, "settings:manage");
  const address = input.address.trim().toLowerCase();
  if (!parseEntry(address)) {
    throw new AppError("VALIDATION", "Enter a valid IP, like 203.0.113.7.", { address: ["Not a valid IP."] });
  }
  const current = await db.ipAllowlistEntry.findMany({ select: { address: true } });
  if (current.some((e) => e.address === address)) throw new AppError("CONFLICT", "This IP is already on the list.", { address: ["Already on the list."] });
  keepsActorIn(actor, [...current.map((e) => e.address), address]);
  const entry = await db.ipAllowlistEntry.create({ data: { address, label: (input.label ?? "").trim(), createdById: actor.userId } });
  forgetIpAllowlist();
  await recordAudit(actor, { action: "security.ip_allowlist_add", entityType: "ip_allowlist", entityId: entry.id, after: { address, label: entry.label } });
  return entry;
}

export async function removeIpAllowlistEntry(actor: Actor, id: string) {
  requirePermission(actor, "settings:manage");
  const entry = await db.ipAllowlistEntry.findUnique({ where: { id } });
  if (!entry) throw new AppError("NOT_FOUND", "This IP is no longer on the list.");
  const rest = await db.ipAllowlistEntry.findMany({ where: { id: { not: id } }, select: { address: true } });
  keepsActorIn(actor, rest.map((e) => e.address));
  await db.ipAllowlistEntry.delete({ where: { id } });
  forgetIpAllowlist();
  await recordAudit(actor, { action: "security.ip_allowlist_remove", entityType: "ip_allowlist", entityId: id, before: { address: entry.address, label: entry.label } });
}
