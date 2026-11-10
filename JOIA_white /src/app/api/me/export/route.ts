import { connection, NextResponse } from "next/server";
import { jsonError, NO_STORE, requireApiActor } from "@/lib/api";
import { exportMyData } from "@/services/member.service";

/** GDPR data export for the signed-in member. */
export async function GET() {
  await connection(); // per-request only; never prerendered
  try {
    const actor = await requireApiActor();
    const data = await exportMyData(actor);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="club-joia-300-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
