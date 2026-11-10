import { NextResponse } from "next/server";
import { jsonError, NO_STORE, requireApiActor } from "@/lib/api";
import { issueQrForMyTicket } from "@/services/qr.service";

/** Issues a fresh short-lived signed QR token for the signed-in member's own ticket. Never cached. */
export async function GET(_req: Request, ctx: RouteContext<"/api/tickets/[ticketNumber]/qr">) {
  try {
    const actor = await requireApiActor();
    const { ticketNumber } = await ctx.params;
    const result = await issueQrForMyTicket(actor, decodeURIComponent(ticketNumber));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    return jsonError(e);
  }
}
