import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { safeEqual } from "@/lib/crypto";
import { AppError, toActionError } from "@/lib/errors";
import { clientIp } from "@/lib/security/ip-allowlist";
import { hitRateLimit } from "@/lib/security/rate-limit";

/**
 * The member app API's key check (src/app/api/member-app, called by the website's server, which
 * shows members their sign-in and card): Authorization: Bearer <MEMBER_API_KEY>. Only wrong keys count,
 * per address, 20 in 15 minutes; past that a wrong key gets 429 for the rest of the window.
 */
const FAILED_KEYS = { limit: 20, window: 15 * 60 };

export const MEMBER_API_NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function requireMemberApiKey(request: Request): Promise<void> {
  const key = env().MEMBER_API_KEY ?? "";
  if (!key) throw new AppError("NOT_CONFIGURED", "The member app API is not set up.");
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  // the right key is never counted: every member's call comes from the website's one address, and many
  // at once (the QR codes at the door) must not look like guessing
  if (safeEqual(given, Buffer.from(key))) return;
  const { allowed } = await hitRateLimit(`memberapi:key:${clientIp(request.headers)}`, FAILED_KEYS.limit, FAILED_KEYS.window);
  if (!allowed) throw new AppError("RATE_LIMITED", "Too many wrong API keys. Please wait 15 minutes.");
  throw new AppError("UNAUTHENTICATED", "Missing or wrong API key.");
}

/** { error: { code, message, fieldErrors? } } with the error's status; unexpected errors are logged (500, toActionError). */
export function memberApiError(e: unknown) {
  const error = toActionError(e);
  return NextResponse.json({ error }, { status: e instanceof AppError ? e.status : 500, headers: MEMBER_API_NO_STORE });
}
