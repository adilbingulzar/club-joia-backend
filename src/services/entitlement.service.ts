import "server-only";
import { db, type Tx } from "@/lib/db";
import { resolveEntitlements, type EntitlementMap } from "@/domain/entitlements";
import { isMembershipUsable, pickCurrentMembership } from "@/domain/membership";
import { AppError } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";

/**
 * EntitlementService — resolves what a member is entitled to from their current tier plus
 * per-member overrides. All privilege checks in the app go through here (never through tier
 * names in UI code).
 */
export async function getMemberEntitlements(memberId: string, tx: Tx | typeof db = db, now = new Date()): Promise<EntitlementMap> {
  const memberships = await tx.membership.findMany({
    where: { memberId },
    select: { status: true, issueDate: true, endDate: true, tierId: true },
  });
  const current = pickCurrentMembership(memberships);
  const tierGrants =
    current && isMembershipUsable(current.status)
      ? await tx.tierEntitlement.findMany({
          where: { tierId: current.tierId, entitlement: { active: true } },
          include: { entitlement: { select: { code: true, valueType: true } } },
        })
      : [];
  const overrides = await tx.memberEntitlement.findMany({
    where: { memberId, entitlement: { active: true } },
    include: { entitlement: { select: { code: true, valueType: true } } },
  });
  return resolveEntitlements(
    tierGrants.map((g) => ({ code: g.entitlement.code, valueType: g.entitlement.valueType, value: g.value })),
    overrides.map((o) => ({ code: o.entitlement.code, valueType: o.entitlement.valueType, value: o.value, expiresAt: o.expiresAt })),
    now,
  );
}

export async function listEntitlementCatalogue() {
  return db.entitlement.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
}

/** Replace a tier's entitlement values. `values[code]` = null removes the grant. */
export async function setTierEntitlements(actor: Actor, tierId: string, values: Record<string, unknown>) {
  requirePermission(actor, "tiers:manage");
  const catalogue = await db.entitlement.findMany();
  const byCode = new Map(catalogue.map((e) => [e.code, e]));
  for (const code of Object.keys(values)) {
    if (!byCode.has(code)) throw new AppError("VALIDATION", `Unknown entitlement: ${code}`);
  }
  await db.$transaction(async (tx) => {
    const before = await tx.tierEntitlement.findMany({ where: { tierId }, include: { entitlement: true } });
    for (const [code, raw] of Object.entries(values)) {
      const ent = byCode.get(code)!;
      if (raw === null || raw === undefined || raw === false || raw === "") {
        await tx.tierEntitlement.deleteMany({ where: { tierId, entitlementId: ent.id } });
        continue;
      }
      const value = (ent.valueType === "INTEGER" ? Number(raw) : ent.valueType === "BOOLEAN" ? true : String(raw)) as Prisma.InputJsonValue;
      if (ent.valueType === "INTEGER" && !Number.isInteger(value)) {
        throw new AppError("VALIDATION", `${ent.name} must be a whole number.`);
      }
      await tx.tierEntitlement.upsert({
        where: { tierId_entitlementId: { tierId, entitlementId: ent.id } },
        create: { tierId, entitlementId: ent.id, value },
        update: { value },
      });
    }
    await recordAudit(
      actor,
      {
        action: "tier.entitlements_update",
        entityType: "membership_tier",
        entityId: tierId,
        before: Object.fromEntries(before.map((b) => [b.entitlement.code, b.value])),
        after: values,
      },
      tx,
    );
  });
}

export async function setMemberEntitlementOverride(
  actor: Actor,
  memberId: string,
  input: { code: string; value: unknown | null; reason?: string; expiresAt?: Date | null },
) {
  requirePermission(actor, "memberships:manage");
  const ent = await db.entitlement.findUnique({ where: { code: input.code } });
  if (!ent) throw new AppError("VALIDATION", "Unknown entitlement.");
  await db.$transaction(async (tx) => {
    if (input.value === null) {
      await tx.memberEntitlement.deleteMany({ where: { memberId, entitlementId: ent.id } });
    } else {
      await tx.memberEntitlement.upsert({
        where: { memberId_entitlementId: { memberId, entitlementId: ent.id } },
        create: { memberId, entitlementId: ent.id, value: input.value as Prisma.InputJsonValue, reason: input.reason, expiresAt: input.expiresAt ?? null },
        update: { value: input.value as Prisma.InputJsonValue, reason: input.reason, expiresAt: input.expiresAt ?? null },
      });
    }
    await recordAudit(actor, { action: "member.entitlement_override", entityType: "member", entityId: memberId, after: input }, tx);
  });
}
