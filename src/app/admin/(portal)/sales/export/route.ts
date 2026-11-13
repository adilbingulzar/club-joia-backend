import { connection } from "next/server";
import { jsonError, NO_STORE, requireApiActor } from "@/lib/api";
import { ordersCsv } from "@/lib/sales/csv";
import { readSalesFilters, today } from "@/lib/sales/filters";
import { exportSalesOrders } from "@/services/sales.service";

/** The website's orders, filtered as on /admin/sales, as a CSV file (up to 10,000 orders). */
export async function GET(request: Request) {
  await connection(); // per-request only; never prerendered
  try {
    const actor = await requireApiActor();
    const f = readSalesFilters(Object.fromEntries(new URL(request.url).searchParams));
    const orders = await exportSalesOrders(actor, f);
    return new Response(ordersCsv(orders), {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="club-joia-orders-${today()}.csv"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
