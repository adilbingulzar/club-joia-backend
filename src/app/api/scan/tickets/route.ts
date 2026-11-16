import { NextResponse } from "next/server";
import { requireScanKey, SCAN_NO_STORE, scanError } from "@/lib/scan-api";
import { listScanRecords } from "@/services/scan-api.service";

/** Scanner API: every ticket with its holder and whether it was scanned (src/services/scan-api.service.ts). */
export async function GET(request: Request) {
  try {
    await requireScanKey(request);
    const records = await listScanRecords();
    return NextResponse.json({ count: records.length, records }, { headers: SCAN_NO_STORE });
  } catch (e) {
    return scanError(e);
  }
}
