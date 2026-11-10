import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/lib/auth/permissions";
import { AppError, forbidden } from "@/lib/errors";

/**
 * Who is performing an operation. Built by the auth layer for each request and passed to
 * every service call — services never read cookies/headers themselves, which keeps them
 * testable and reusable by future callers (cron jobs, AI concierge agent, native apps).
 */
export type Actor = {
  userId: string;
  role: Role;
  memberId: string | null;
  sessionId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};


export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw forbidden();
}

export function requireMemberActor(actor: Actor): string {
  if (actor.role !== "MEMBER" || !actor.memberId) {
    throw new AppError("FORBIDDEN", "This area is for members only.");
  }
  return actor.memberId;
}
