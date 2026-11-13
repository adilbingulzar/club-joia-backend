import { connection } from "next/server";
import { jsonError, NO_STORE, requireApiActor } from "@/lib/api";
import { registrationsCsv } from "@/lib/sales/csv";
import { today } from "@/lib/sales/filters";
import { exportPreRegistrations } from "@/services/sales.service";

/** The website's pre-registrations, searched as on /admin/sales/registrations, as a CSV file. */
export async function GET(request: Request) {
  await connection(); // per-request only; never prerendered
  try {
    const actor = await requireApiActor();
    const q = String(new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
    const list = await exportPreRegistrations(actor, q);
    return new Response(registrationsCsv(list), {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clubjoia300-preregistrations-${today()}.csv"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
