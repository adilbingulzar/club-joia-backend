import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { STAFF_ROLES } from "@/lib/auth/permissions";
import type { ConciergeCategory, Role } from "@/generated/prisma/enums";
import { recordAudit } from "./audit.service";
import { issueActivation, revokeAllSessions } from "./auth.service";
import { requirePermission, type Actor } from "./context";

/** StaffService — staff accounts and role management (SUPER_ADMIN only). */

export async function listStaff(actor: Actor) {
  requirePermission(actor, "staff:manage");
  return db.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, mfaEnabled: true, createdAt: true,
      whatsappNumber: true, alertByEmail: true, alertByWhatsapp: true, conciergeCategories: true,
    },
  });
}

/** How a staff member is reached for operational alerts (concierge new requests / assignments). */
export type StaffContact = {
  whatsappNumber: string | null;
  alertByEmail: boolean;
  alertByWhatsapp: boolean;
  /** Concierge request categories this person is responsible for (drives new-request alerts). */
  conciergeCategories: ConciergeCategory[];
};

export async function createStaff(actor: Actor, input: { name: string; email: string; role: Role } & Partial<StaffContact>) {
  requirePermission(actor, "staff:manage");
  if (!STAFF_ROLES.includes(input.role)) throw new AppError("VALIDATION", "Choose a staff role.");
  if (await db.user.findUnique({ where: { email: input.email } })) {
    throw new AppError("CONFLICT", "An account with this email already exists.", { email: ["Already in use."] });
  }
  const user = await db.user.create({
    data: {
      name: input.name, email: input.email, role: input.role, status: "PENDING_ACTIVATION",
      whatsappNumber: input.whatsappNumber ?? null,
      alertByEmail: input.alertByEmail ?? true,
      alertByWhatsapp: input.alertByWhatsapp ?? false,
      conciergeCategories: input.conciergeCategories ?? [],
    },
  });
  await recordAudit(actor, { action: "staff.create", entityType: "user", entityId: user.id, after: { email: user.email, role: user.role } });
  const activation = await issueActivation(user.id);
  return { userId: user.id, activation };
}

export async function changeRole(actor: Actor, userId: string, role: Role) {
  requirePermission(actor, "staff:manage");
  if (!STAFF_ROLES.includes(role)) throw new AppError("VALIDATION", "Choose a staff role.");
  if (userId === actor.userId) throw new AppError("INVALID_STATE", "You cannot change your own role.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "MEMBER") throw notFound("Staff member");
  if (user.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const supers = await db.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE" } });
    if (supers <= 1) throw new AppError("INVALID_STATE", "At least one active super admin is required.");
  }
  await db.user.update({ where: { id: userId }, data: { role } });
  // Force a fresh sign-in so the new permissions (and session lifetime) apply immediately.
  await revokeAllSessions(userId);
  await recordAudit(actor, { action: "staff.role_change", entityType: "user", entityId: userId, before: { role: user.role }, after: { role } });
}

export async function setStaffStatus(actor: Actor, userId: string, status: "ACTIVE" | "DISABLED") {
  requirePermission(actor, "staff:manage");
  if (userId === actor.userId) throw new AppError("INVALID_STATE", "You cannot disable your own account.");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "MEMBER") throw notFound("Staff member");
  if (status === "ACTIVE" && !user.passwordHash) throw new AppError("INVALID_STATE", "This person has not activated their account yet.");
  await db.user.update({ where: { id: userId }, data: { status } });
  if (status === "DISABLED") await revokeAllSessions(userId);
  await recordAudit(actor, { action: status === "DISABLED" ? "staff.disable" : "staff.enable", entityType: "user", entityId: userId, before: { status: user.status }, after: { status } });
}

export async function resendStaffInvitation(actor: Actor, userId: string) {
  requirePermission(actor, "staff:manage");
  const result = await issueActivation(userId);
  await recordAudit(actor, { action: "staff.invitation_issue", entityType: "user", entityId: userId });
  return result;
}

export async function updateStaffContact(actor: Actor, userId: string, input: StaffContact & { name: string }) {
  requirePermission(actor, "staff:manage");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role === "MEMBER") throw notFound("Staff member");
  if (input.alertByWhatsapp && !input.whatsappNumber) throw new AppError("VALIDATION", "Add a WhatsApp number to receive WhatsApp alerts.", { whatsappNumber: ["Required for WhatsApp alerts."] });
  const data = {
    name: input.name,
    whatsappNumber: input.whatsappNumber,
    alertByEmail: input.alertByEmail,
    alertByWhatsapp: input.alertByWhatsapp,
    conciergeCategories: input.conciergeCategories,
  };
  await db.user.update({ where: { id: userId }, data });
  await recordAudit(actor, {
    action: "staff.contact_update",
    entityType: "user",
    entityId: userId,
    before: { name: user.name, whatsappNumber: user.whatsappNumber, alertByEmail: user.alertByEmail, alertByWhatsapp: user.alertByWhatsapp, conciergeCategories: user.conciergeCategories },
    after: data,
  });
}
