import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { safeEqual } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { clientIp } from "@/lib/security/ip-allowlist";
import { hitRateLimit } from "@/lib/security/rate-limit";
import type { Caller } from "@/services/scan-api.service";

/**
 * The scanner API's key check (src/app/api/scan): the X-Api-Key header must equal SCAN_API_KEY.
 * Only wrong keys count, per address, 20 in 15 minutes; past that a wrong key gets 429 for the rest
 * of the window. The right key always passes.
 */
const FAILED_KEYS = { limit: 20, window: 15 * 60 };

export const SCAN_NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function requireScanKey(request: Request): Promise<Caller> {
  const key = env().SCAN_API_KEY ?? "";
  if (!key) throw new AppError("NOT_CONFIGURED", "The scanner API is not set up.");
  const ip = clientIp(request.headers);
  const given = Buffer.from(request.headers.get("x-api-key") ?? "");
  // the right key is never counted: the scanners at a venue often share one address (its WiFi), and
  // many scans at once at the door must not look like guessing
  if (safeEqual(given, Buffer.from(key))) return { ipAddress: ip || null, userAgent: request.headers.get("user-agent") };
  const { allowed } = await hitRateLimit(`scanapi:key:${ip}`, FAILED_KEYS.limit, FAILED_KEYS.window);
  if (!allowed) throw new AppError("RATE_LIMITED", "Too many wrong API keys. Please wait 15 minutes.");
  throw new AppError("UNAUTHENTICATED", "Missing or wrong API key.");
}

/** { error: message } with the error's status; unexpected errors are logged and answer 500. */
export function scanError(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status, headers: SCAN_NO_STORE });
  console.error("[scan-api]", e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500, headers: SCAN_NO_STORE });
}
