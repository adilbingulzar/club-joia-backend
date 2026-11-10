import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { canTransitionMembership, effectiveMembershipStatus, pickCurrentMembership } from "@/domain/membership";
import type { MembershipStatus } from "@/generated/prisma/enums";
import { dateOnly, parseDateOnly } from "@/lib/time";
import { recordAudit } from "./audit.service";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { getMemberEntitlements } from "./entitlement.service";
import { notifyMember } from "./notification.service";

/** MembershipService — tiers and the memberships that place a member in a tier. */

export async function listTiers(opts: { includeInactive?: boolean } = {}) {
  return db.membershipTier.findMany({
    where: opts.includeInactive ? {} : { active: true },
    orderBy: { sortOrder: "asc" },
    include: {
      entitlements: { include: { entitlement: true } },
      _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
    },
  });
}

export async function updateTier(
  actor: Actor,
  tierId: string,
  data: { displayName: string; description?: string | null; color: string; sortOrder: number; active: boolean },
) {
  requirePermission(actor, "tiers:manage");
  const before = await db.membershipTier.findUnique({ where: { id: tierId } });
  if (!before) throw notFound("Tier");
  const after = await db.membershipTier.update({ where: { id: tierId }, data });
  await recordAudit(actor, { action: "tier.update", entityType: "membership_tier", entityId: tierId, before, after });
  return after;
}

/** The signed-in member's membership card data. */
export async function getMyMembership(actor: Actor) {
  const memberId = requireMemberActor(actor);
  const member = await db.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { memberships: { include: { tier: true, homeChapter: true } } },
  });
  const current = pickCurrentMembership(member.memberships);
  const entitlements = await getMemberEntitlements(memberId);
  const catalogue = await db.entitlement.findMany({ where: { active: true } });
  return {
    member: {
      firstName: member.firstName,
      lastName: member.lastName,
      displayName: member.displayName,
      membershipNumber: member.membershipNumber,
      memberSince: member.memberSince,
      hasPhoto: Boolean(member.profilePhotoKey),
    },
    membership: current
      ? {
          membershipNumber: current.membershipNumber,
          status: effectiveMembershipStatus(current, dateOnly(new Date())),
          startDate: current.startDate ? dateOnly(current.startDate) : null,
          endDate: current.endDate ? dateOnly(current.endDate) : null,
          issueDate: current.issueDate,
          kind: current.kind,
          tier: {
            slug: current.tier.slug,
            name: current.tier.name,
            displayName: current.tier.displayName,
            description: current.tier.description,
            color: current.tier.color,
            cardTheme: current.tier.cardTheme,
          },
          homeChapter: current.homeChapter ? { name: current.homeChapter.name, city: current.homeChapter.city } : null,
        }
      : null,
    privileges: catalogue
      .filter((e) => e.code in entitlements)
      .map((e) => ({ code: e.code, name: e.name, description: e.description, value: entitlements[e.code], category: e.category })),
  };
}

export type AssignMembershipInput = {
  tierId: string;
  status: MembershipStatus;
  startDate?: string | null;
  endDate?: string | null;
  homeChapterId?: string | null;
};

/**
 * Assign or change a member's tier. If the member has a current membership it is updated in
 * place (keeping its number); otherwise a new membership is created with the member's number.
 */
export async function assignMembership(actor: Actor, memberId: string, input: AssignMembershipInput) {
  requirePermission(actor, "memberships:manage");
  const member = await db.member.findUnique({ where: { id: memberId }, include: { memberships: true, user: true } });
  if (!member) throw notFound("Member");
  const tier = await db.membershipTier.findUnique({ where: { id: input.tierId } });
  if (!tier || !tier.active) throw new AppError("VALIDATION", "Choose an active tier.");

  const current = pickCurrentMembership(member.memberships);
  const status = input.status;
  if (status === "ACTIVE" && member.user.status === "PENDING_ACTIVATION") {
    throw new AppError("INVALID_STATE", "This member has not activated their account yet. Keep the membership as Invited until they do.");
  }
  if (current && !canTransitionMembership(current.status, status)) {
    throw new AppError("INVALID_STATE", `A ${current.status.toLowerCase()} membership cannot move to ${status.toLowerCase()}.`);
  }
  const data = {
    tierId: tier.id,
    status,
    startDate: input.startDate ? parseDateOnly(input.startDate) : null,
    endDate: input.endDate ? parseDateOnly(input.endDate) : null,
    homeChapterId: input.homeChapterId || null,
  };

  const result = await db.$transaction(async (tx) => {
    const saved = current
      ? await tx.membership.update({ where: { id: current.id }, data })
      : await tx.membership.create({ data: { ...data, memberId, membershipNumber: member.membershipNumber } });
    await recordAudit(
      actor,
      { action: current ? "membership.update" : "membership.create", entityType: "membership", entityId: saved.id, before: current, after: saved },
      tx,
    );
    return saved;
  });

  if (current && current.tierId !== tier.id && status === "ACTIVE") {
    await notifyMember(member.id, {
      title: `Welcome to ${tier.displayName}`,
      body: `Your CLUB JOIA 300 membership is now ${tier.displayName}.`,
      type: "MEMBERSHIP",
      url: "/card",
    });
  }
  return result;
}

export async function setMembershipStatus(actor: Actor, memberId: string, status: MembershipStatus, reason?: string) {
  requirePermission(actor, "memberships:manage");
  const memberships = await db.membership.findMany({ where: { memberId } });
  const current = pickCurrentMembership(memberships);
  if (!current) throw new AppError("INVALID_STATE", "This member has no membership yet. Assign a tier first.");
  if (!canTransitionMembership(current.status, status)) {
    throw new AppError("INVALID_STATE", `A ${current.status.toLowerCase()} membership cannot move to ${status.toLowerCase()}.`);
  }
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.membership.update({
      where: { id: current.id },
      data: { status, metadata: { ...(current.metadata as object), lastStatusReason: reason ?? null } },
    });
    await recordAudit(
      actor,
      {
        action: status === "SUSPENDED" ? "membership.suspend" : `membership.status_${status.toLowerCase()}`,
        entityType: "membership",
        entityId: current.id,
        before: { status: current.status },
        after: { status, reason },
      },
      tx,
    );
    return u;
  });
  return updated;
}
