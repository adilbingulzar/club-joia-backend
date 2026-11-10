import "server-only";
import { db, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { pickCurrentMembership } from "@/domain/membership";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import type { Prisma } from "@/generated/prisma/client";
import type { MembershipStatus, UserStatus } from "@/generated/prisma/enums";
import { recordAudit } from "./audit.service";
import { issueActivation, revokeAllSessions } from "./auth.service";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { deleteStoredObject, storeUpload } from "./storage.service";

/** MemberService — member profiles (self-service + admin management) and GDPR operations. */

export type MemberPreferences = {
  hospitality?: { seatingPreference?: string | null; drinksPreference?: string | null; arrivalNotes?: string | null };
  notifications?: { push?: boolean; programmeUpdates?: boolean; conciergeUpdates?: boolean };
};
export type PrivacySettings = { marketingEmails?: boolean };

// ─── Self-service ───────────────────────────────────────────────────────────

export async function getMyProfile(actor: Actor) {
  const memberId = requireMemberActor(actor);
  const member = await db.member.findUniqueOrThrow({
    where: { id: memberId },
    include: { user: { select: { email: true, lastLoginAt: true, passwordChangedAt: true } } },
  });
  return {
    ...member,
    preferences: (member.preferences ?? {}) as MemberPreferences,
    privacySettings: (member.privacySettings ?? {}) as PrivacySettings,
  };
}

/** Fields members may change themselves. Everything else is admin-only. */
const SELF_EDITABLE = new Set([
  "displayName", "mobile", "country", "city", "nationality", "company", "jobTitle", "industry", "bio",
  "dietaryRequirements", "allergies", "shirtSize", "emergencyContactName", "emergencyContactPhone",
]);

export async function updateMyProfile(
  actor: Actor,
  patch: Record<string, unknown>,
  extras: { preferences?: Partial<MemberPreferences>; privacy?: PrivacySettings } = {},
) {
  const memberId = requireMemberActor(actor);
  for (const key of Object.keys(patch)) {
    if (!SELF_EDITABLE.has(key)) throw new AppError("FORBIDDEN", "That field can only be changed by CLUB JOIA.");
  }
  const before = await db.member.findUniqueOrThrow({ where: { id: memberId } });
  const prefs = (before.preferences ?? {}) as MemberPreferences;
  const data: Prisma.MemberUpdateInput = { ...patch };
  if (extras.preferences) {
    data.preferences = {
      ...prefs,
      ...(extras.preferences.hospitality ? { hospitality: { ...prefs.hospitality, ...extras.preferences.hospitality } } : {}),
      ...(extras.preferences.notifications ? { notifications: { ...prefs.notifications, ...extras.preferences.notifications } } : {}),
    } as Prisma.InputJsonValue;
  }
  if (extras.privacy) {
    data.privacySettings = { ...((before.privacySettings ?? {}) as object), ...extras.privacy } as Prisma.InputJsonValue;
  }
  await db.member.update({ where: { id: memberId }, data });
  const prevMarketing = Boolean(((before.privacySettings ?? {}) as PrivacySettings).marketingEmails);
  if (extras.privacy && extras.privacy.marketingEmails !== undefined && extras.privacy.marketingEmails !== prevMarketing) {
    await db.consentRecord.create({
      data: {
        userId: actor.userId,
        type: "MARKETING",
        version: "v1",
        granted: extras.privacy.marketingEmails,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent?.slice(0, 500) ?? null,
      },
    });
  }
  await recordAudit(actor, {
    action: "member.profile_self_update",
    entityType: "member",
    entityId: memberId,
    after: { fields: [...Object.keys(patch), ...Object.keys(extras)] },
  });
}

export async function setMyPhoto(actor: Actor, file: File) {
  const memberId = requireMemberActor(actor);
  await enforceRateLimit(`upload:${actor.userId}`, RATE_LIMITS.uploadPerUser.limit, RATE_LIMITS.uploadPerUser.window);
  const { key } = await storeUpload(file, "PROFILE_PHOTO", actor.userId);
  const before = await db.member.findUniqueOrThrow({ where: { id: memberId }, select: { profilePhotoKey: true } });
  await db.member.update({ where: { id: memberId }, data: { profilePhotoKey: key } });
  if (before.profilePhotoKey) await deleteStoredObject(before.profilePhotoKey).catch(() => {});
  await recordAudit(actor, { action: "member.photo_update", entityType: "member", entityId: memberId });
}

export async function removeMyPhoto(actor: Actor) {
  const memberId = requireMemberActor(actor);
  const m = await db.member.findUniqueOrThrow({ where: { id: memberId }, select: { profilePhotoKey: true } });
  if (!m.profilePhotoKey) return;
  await db.member.update({ where: { id: memberId }, data: { profilePhotoKey: null } });
  await deleteStoredObject(m.profilePhotoKey).catch(() => {});
}

/** GDPR data portability: everything we hold about the member, as JSON. */
export async function exportMyData(actor: Actor) {
  const memberId = requireMemberActor(actor);
  await enforceRateLimit(`export:${actor.userId}`, RATE_LIMITS.exportPerUser.limit, RATE_LIMITS.exportPerUser.window);
  const member = await db.member.findUniqueOrThrow({
    where: { id: memberId },
    include: {
      user: { select: { email: true, createdAt: true, lastLoginAt: true, consents: true } },
      memberships: { include: { tier: { select: { displayName: true } } } },
      tickets: { select: { ticketNumber: true, status: true, validFrom: true, validUntil: true, ticketType: { select: { name: true } }, checkIns: { select: { checkedInAt: true } } } },
      favorites: { select: { createdAt: true, programItem: { select: { title: true, date: true } } } },
      conciergeRequests: { include: { messages: { where: { internalNote: false }, select: { message: true, createdAt: true, senderType: true } } } },
      notificationRecipients: { where: { deliveryChannel: "IN_APP" }, select: { readAt: true, notification: { select: { title: true, body: true, sentAt: true } } } },
    },
  });
  await recordAudit(actor, { action: "member.data_export", entityType: "member", entityId: memberId });
  return { exportedAt: new Date().toISOString(), format: "CLUB JOIA 300 member data export v1", data: member };
}

export async function requestAccountDeletion(actor: Actor) {
  const memberId = requireMemberActor(actor);
  await db.member.update({ where: { id: memberId }, data: { deletionRequestedAt: new Date() } });
  await recordAudit(actor, { action: "member.deletion_requested", entityType: "member", entityId: memberId });
}

// ─── Staff / admin ──────────────────────────────────────────────────────────

export type MemberListQuery = {
  q?: string;
  tierId?: string;
  status?: MembershipStatus | "NONE";
  account?: UserStatus;
  page?: number;
};

export async function listMembers(actor: Actor, query: MemberListQuery = {}) {
  requirePermission(actor, "members:view");
  const pageSize = 25;
  const page = Math.max(query.page ?? 1, 1);
  const q = query.q?.trim();
  const where: Prisma.MemberWhereInput = {
    anonymizedAt: null,
    ...(q
      ? {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { membershipNumber: { contains: q } },
            { user: { email: { contains: q } } },
            { company: { contains: q } },
          ],
        }
      : {}),
    ...(query.tierId ? { memberships: { some: { tierId: query.tierId } } } : {}),
    ...(query.status === "NONE"
      ? { memberships: { none: {} } }
      : query.status
        ? { memberships: { some: { status: query.status } } }
        : {}),
    ...(query.account ? { user: { status: query.account } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.member.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { email: true, status: true, lastLoginAt: true } },
        memberships: { include: { tier: true } },
        _count: { select: { tickets: { where: { status: "ACTIVE" } } } },
      },
    }),
    db.member.count({ where }),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: rows.map((m) => ({ ...m, currentMembership: pickCurrentMembership(m.memberships) })),
  };
}

export async function getMemberForStaff(actor: Actor, memberId: string) {
  if (!can(actor.role, "members:view") && !can(actor.role, "members:view_basic")) {
    requirePermission(actor, "members:view");
  }
  const full = can(actor.role, "members:view");
  const member = await db.member.findUnique({
    where: { id: memberId },
    include: {
      user: { select: { id: true, email: true, status: true, lastLoginAt: true, createdAt: true } },
      memberships: { include: { tier: true, homeChapter: true }, orderBy: { issueDate: "desc" } },
      entitlementGrants: { include: { entitlement: true } },
    },
  });
  if (!member) throw notFound("Member");
  const current = pickCurrentMembership(member.memberships);
  if (!full) {
    // Concierge view: only what is needed to serve the member.
    return {
      scope: "basic" as const,
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      displayName: member.displayName,
      membershipNumber: member.membershipNumber,
      email: member.user.email,
      mobile: member.mobile,
      dietaryRequirements: member.dietaryRequirements,
      allergies: member.allergies,
      tier: current?.tier.displayName ?? null,
      membershipStatus: current?.status ?? null,
    };
  }
  return { scope: "full" as const, ...member, currentMembership: current };
}

async function nextMembershipNumber(tx: Tx): Promise<string> {
  // Numbers look like CJ300-0001; the digits start at character 7. Concurrent creators can read
  // the same MAX — the unique index then rejects one and createMember retries.
  const rows = await tx.$queryRaw<{ max: number | bigint | null }[]>`
    SELECT MAX(CAST(SUBSTRING(\`membership_number\`, 7) AS UNSIGNED)) AS \`max\` FROM \`members\`
    WHERE \`membership_number\` REGEXP '^CJ300-[0-9]+$'`;
  const next = (Number(rows[0]?.max ?? 0) || 0) + 1;
  return `CJ300-${String(next).padStart(4, "0")}`;
}

export type CreateMemberInput = {
  firstName: string;
  lastName: string;
  email: string;
  tierId: string;
  homeChapterId?: string | null;
  sendInvitation: boolean;
} & Partial<Record<
  | "displayName" | "mobile" | "country" | "city" | "nationality" | "company" | "jobTitle" | "industry"
  | "dietaryRequirements" | "allergies" | "emergencyContactName" | "emergencyContactPhone",
  string | null
>>;

export async function createMember(actor: Actor, input: CreateMemberInput) {
  requirePermission(actor, "members:manage");
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError("CONFLICT", "An account with this email already exists.", { email: ["Already in use."] });
  const tier = await db.membershipTier.findUnique({ where: { id: input.tierId } });
  if (!tier) throw new AppError("VALIDATION", "Choose a membership tier.");

  const { tierId, homeChapterId, sendInvitation, email, ...profile } = input;
  void tierId;
  let created: { memberId: string; userId: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    try {
      created = await db.$transaction(async (tx) => {
        const membershipNumber = await nextMembershipNumber(tx);
        const user = await tx.user.create({
          data: { email, name: `${input.firstName} ${input.lastName}`, role: "MEMBER", status: "PENDING_ACTIVATION" },
        });
        const member = await tx.member.create({ data: { ...profile, userId: user.id, membershipNumber } });
        await tx.membership.create({
          data: { memberId: member.id, tierId: tier.id, membershipNumber, status: "INVITED", homeChapterId: homeChapterId || null },
        });
        await recordAudit(actor, { action: "member.create", entityType: "member", entityId: member.id, after: { email, membershipNumber, tier: tier.slug } }, tx);
        return { memberId: member.id, userId: user.id };
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt === 2) throw e;
    }
  }
  const activation = sendInvitation ? await issueActivation(created!.userId) : null;
  return { memberId: created!.memberId, activation };
}

export async function updateMemberAdmin(actor: Actor, memberId: string, input: Omit<CreateMemberInput, "tierId" | "homeChapterId" | "sendInvitation">) {
  requirePermission(actor, "members:manage");
  const before = await db.member.findUnique({ where: { id: memberId }, include: { user: true } });
  if (!before) throw notFound("Member");
  const { email, ...profile } = input;
  if (email !== before.user.email) {
    const clash = await db.user.findUnique({ where: { email } });
    if (clash) throw new AppError("CONFLICT", "Another account uses this email.", { email: ["Already in use."] });
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: before.userId }, data: { email, name: `${input.firstName} ${input.lastName}` } });
    const after = await tx.member.update({ where: { id: memberId }, data: profile });
    const { user, ...beforeMember } = before;
    await recordAudit(actor, { action: "member.update", entityType: "member", entityId: memberId, before: { ...beforeMember, email: user.email }, after: { ...after, email } }, tx);
  });
}

/** Disable / re-enable sign-in for a member account (separate from membership status). */
export async function setMemberAccountStatus(actor: Actor, memberId: string, status: "ACTIVE" | "DISABLED") {
  requirePermission(actor, "members:manage");
  const member = await db.member.findUnique({ where: { id: memberId }, include: { user: true } });
  if (!member) throw notFound("Member");
  if (status === "ACTIVE" && !member.user.passwordHash) {
    throw new AppError("INVALID_STATE", "This member has not activated their account yet. Re-send the invitation instead.");
  }
  await db.user.update({ where: { id: member.userId }, data: { status } });
  if (status === "DISABLED") await revokeAllSessions(member.userId);
  await recordAudit(actor, {
    action: status === "DISABLED" ? "member.account_disable" : "member.account_enable",
    entityType: "member",
    entityId: memberId,
    before: { status: member.user.status },
    after: { status },
  });
}

export async function resendInvitation(actor: Actor, memberId: string) {
  requirePermission(actor, "members:manage");
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) throw notFound("Member");
  const result = await issueActivation(member.userId);
  await recordAudit(actor, { action: "member.invitation_issue", entityType: "member", entityId: memberId });
  return result;
}

/**
 * GDPR erasure: removes personal data while keeping operational records (tickets, scans,
 * audit) linked to an anonymous shell. Irreversible.
 */
export async function anonymizeMember(actor: Actor, memberId: string) {
  requirePermission(actor, "members:manage");
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) throw notFound("Member");
  if (member.anonymizedAt) throw new AppError("INVALID_STATE", "This member is already anonymised.");
  await db.$transaction(async (tx) => {
    await tx.member.update({
      where: { id: memberId },
      data: {
        firstName: "Former",
        lastName: "Member",
        displayName: null, mobile: null, country: null, city: null, nationality: null, profilePhotoKey: null,
        company: null, jobTitle: null, industry: null, bio: null, dietaryRequirements: null, allergies: null,
        emergencyContactName: null, emergencyContactPhone: null, shirtSize: null,
        preferences: {}, privacySettings: {}, networkingProfileEnabled: false, networkingInterests: [], lookingToMeet: [],
        linkedinUrl: null, investmentInterests: [], socialLinks: {}, publicProfileFields: [],
        anonymizedAt: new Date(),
      },
    });
    await tx.user.update({
      where: { id: member.userId },
      data: { email: `erased+${member.userId}@invalid.local`, name: "Former member", passwordHash: null, status: "DISABLED" },
    });
    await tx.session.updateMany({ where: { userId: member.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.pushSubscription.deleteMany({ where: { userId: member.userId } });
    await tx.ticket.updateMany({ where: { memberId, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date(), revokeReason: "Member erased" } });
    await tx.membership.updateMany({ where: { memberId, status: { in: ["ACTIVE", "INVITED", "SUSPENDED"] } }, data: { status: "CANCELLED" } });
    await recordAudit(actor, { action: "member.anonymize", entityType: "member", entityId: memberId }, tx);
  });
  if (member.profilePhotoKey) await deleteStoredObject(member.profilePhotoKey).catch(() => {});
}

export async function listChapters() {
  return db.chapter.findMany({ where: { active: true }, orderBy: { name: "asc" } });
}
