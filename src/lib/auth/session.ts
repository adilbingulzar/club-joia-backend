import "server-only";
import { cookies, headers } from "next/headers";
import { isProduction } from "@/lib/config/env";
import type { RequestMeta } from "@/services/auth.service";

/** `__Host-` prefix pins the cookie to this exact origin over HTTPS (production only). */
export const SESSION_COOKIE = isProduction() ? "__Host-joia_session" : "joia_session";

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Only callable from Server Actions / Route Handlers. */
export async function writeSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Client IP + user agent for audit/rate limiting. Trusts the platform proxy's X-Forwarded-For. */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}
