import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { requireScanKey, SCAN_NO_STORE, scanError } from "@/lib/scan-api";
import { getScanRecord, setScanned } from "@/services/scan-api.service";

/** Scanner API: one ticket by its ticket number (src/services/scan-api.service.ts). */
export async function GET(request: Request, ctx: RouteContext<"/api/scan/tickets/[ticketId]">) {
  try {
    await requireScanKey(request);
    const { ticketId } = await ctx.params;
    return NextResponse.json(await getScanRecord(decodeURIComponent(ticketId)), { headers: SCAN_NO_STORE });
  } catch (e) {
    return scanError(e);
  }
}

/** { "scanned": 1 } marks the ticket scanned, { "scanned": 0 } undoes it. */
export async function PUT(request: Request, ctx: RouteContext<"/api/scan/tickets/[ticketId]">) {
  try {
    const caller = await requireScanKey(request);
    const { ticketId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { scanned?: unknown } | null;
    const value = body?.scanned;
    const scanned = value === 1 || value === "1" || value === true ? 1 : value === 0 || value === "0" || value === false ? 0 : null;
    if (scanned === null) throw new AppError("VALIDATION", 'Send a JSON body {"scanned": 1} or {"scanned": 0}.');
    return NextResponse.json(await setScanned(decodeURIComponent(ticketId), scanned, caller), { headers: SCAN_NO_STORE });
  } catch (e) {
    return scanError(e);
  }
}
