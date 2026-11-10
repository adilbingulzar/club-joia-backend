import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { AppError, notFound } from "@/lib/errors";
import { jsonError, requireApiActor } from "@/lib/api";
import { readStoredObject } from "@/services/storage.service";

/**
 * Serves private uploads after an authorisation check:
 *   PROFILE_PHOTO         → the owner, check-in staff (identity verification), member-viewing staff
 *   CONCIERGE_ATTACHMENT  → the request's member and concierge staff
 *   EVENT/PROGRAMME_IMAGE → any signed-in user
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  try {
    const actor = await requireApiActor();
    const key = (await ctx.params).key.join("/");
    const object = await readStoredObject(key);
    if (!object) throw notFound("File");
    const { meta, body } = object;

    let allowed = meta.ownerUserId === actor.userId;
    if (!allowed) {
      switch (meta.purpose) {
        case "PROFILE_PHOTO":
          allowed = can(actor.role, "scan:validate") || can(actor.role, "members:view_basic") || can(actor.role, "members:view");
          break;
        case "CONCIERGE_ATTACHMENT": {
          if (can(actor.role, "concierge:view_all")) allowed = true;
          else if (actor.memberId) {
            const msg = await db.conciergeRequestMessage.findFirst({ where: { attachmentKey: key }, select: { request: { select: { memberId: true } } } });
            allowed = msg?.request.memberId === actor.memberId;
          }
          break;
        }
        default:
          allowed = true;
      }
    }
    if (!allowed) throw new AppError("NOT_FOUND", "File not found.");

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": meta.contentType,
        "Content-Length": String(body.length),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": meta.contentType === "application/pdf" ? "attachment" : "inline",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
