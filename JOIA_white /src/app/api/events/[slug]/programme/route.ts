import { NextResponse } from "next/server";
import { jsonError, requireApiActor } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getPublicProgramme } from "@/services/programme.service";

/**
 * Non-personalised programme (published, unrestricted items only). Signed-in users only.
 * The service worker caches this response so the programme is readable offline.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/events/[slug]/programme">) {
  try {
    await requireApiActor();
    const { slug } = await ctx.params;
    const data = await getPublicProgramme(slug);
    if (!data) throw notFound("Event");
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-cache" } });
  } catch (e) {
    return jsonError(e);
  }
}
