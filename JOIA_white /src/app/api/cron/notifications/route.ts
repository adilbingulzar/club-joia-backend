import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { env } from "@/lib/config/env";
import { safeEqual } from "@/lib/crypto";
import { processDueNotifications } from "@/services/notification.service";

/**
 * Delivers scheduled notifications that are due. Call every minute from any scheduler
 * (Vercel Cron, GitHub Actions, a server crontab…) with:  Authorization: Bearer $CRON_SECRET
 */
export async function GET() {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  const auth = (await headers()).get("authorization") ?? "";
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ""));
  if (!safeEqual(given, Buffer.from(secret))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await processDueNotifications();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
