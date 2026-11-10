import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { validateSessionToken, type SessionUser } from "@/services/auth.service";
import type { Actor } from "@/services/context";
import { can, homePathFor, type Permission } from "./permissions";
import { readSessionToken, requestMeta } from "./session";

/**
 * Data Access Layer: the only place pages and actions turn a cookie into an Actor.
 * Memoised per request with React.cache, so many components can call it cheaply.
 * Always call it inside a <Suspense> boundary (it reads cookies at request time).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  return validateSessionToken(await readSessionToken());
});

export const getActor = cache(async (): Promise<Actor | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const meta = await requestMeta();
  return {
    userId: user.userId,
    role: user.role,
    memberId: user.memberId,
    sessionId: user.sessionId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };
});

export async function requireActor(loginPath = "/login"): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(loginPath);
  return actor;
}

/** Member-only pages. Staff are sent to their own home. */
export async function requireMember(): Promise<Actor & { memberId: string }> {
  const actor = await requireActor();
  if (actor.role !== "MEMBER" || !actor.memberId) redirect(homePathFor(actor.role));
  return actor as Actor & { memberId: string };
}

/** Staff pages gated by a permission. */
export async function requirePermissionPage(permission: Permission): Promise<Actor> {
  const actor = await requireActor("/admin/login");
  if (!can(actor.role, permission)) redirect(actor.role === "MEMBER" ? "/" : "/no-access");
  return actor;
}
