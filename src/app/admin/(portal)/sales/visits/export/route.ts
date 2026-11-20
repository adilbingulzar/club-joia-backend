import { connection } from "next/server";
import { jsonError, NO_STORE, requireApiActor } from "@/lib/api";
import { readSalesFilters, today } from "@/lib/sales/filters";
import { visitsCsv } from "@/lib/sales/visits";
import { exportVisits } from "@/services/visits.service";

/** The website's daily visit report for the period on /admin/sales/visits, as a CSV file. */
export async function GET(request: Request) {
  await connection(); // per-request only; never prerendered
  try {
    const actor = await requireApiActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const f = readSalesFilters(params);
    const days = await exportVisits(actor, { from: f.from, to: f.to });
    return new Response(visitsCsv(days), {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clubjoia300-visits-${today()}.csv"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
