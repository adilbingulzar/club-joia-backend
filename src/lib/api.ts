import "server-only";
import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/dal";
import { AppError, toActionError } from "@/lib/errors";
import type { Actor } from "@/services/context";

/**
 * Route Handler helpers: JSON error envelope, auth, and same-origin enforcement for
 * state-changing requests (CSRF defence for endpoints that are not Server Actions).
 */
export const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export function jsonError(e: unknown) {
  const error = toActionError(e);
  const status = e instanceof AppError ? e.status : 500;
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function requireApiActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return actor;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  }
}
