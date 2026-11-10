import "server-only";
import { db } from "@/lib/db";
import { conciergeCategoryList } from "@/lib/json-list";
import { env } from "@/lib/config/env";
import { CONCIERGE_CATEGORY_LABELS, selectNewRequestRecipients } from "@/domain/concierge";
import { sendEmail } from "./email.service";
import { sendWhatsApp } from "./whatsapp.service";

/**
 * StaffAlertService — operational alerts to staff by email and/or WhatsApp, according to each
 * person's preferences (Admin → Staff). Alerts are best-effort: a provider failure never blocks
 * the member's request. The outcome is recorded as an internal (staff-only) note on the request.
 *
 * Alert content is deliberately minimal (reference, category, subject, link) — member details stay
 * behind the staff portal sign-in.
 */

type Recipient = { id: string; name: string; email: string; whatsappNumber: string | null; alertByEmail: boolean; alertByWhatsapp: boolean };

const link = (requestId: string) => new URL(`/admin/concierge/${requestId}`, env().NEXT_PUBLIC_APP_URL).toString();

async function deliver(r: Recipient, subject: string, text: string, wa: { title: string; details: string; link: string }) {
  const channels: string[] = [];
  const failed: string[] = [];
  if (r.alertByEmail) {
    const res = await sendEmail({ to: r.email, subject, text });
    (res.delivered ? channels : failed).push(res.delivered ? "email" : `email (${res.driver === "console" ? "not configured" : "failed"})`);
  }
  if (r.alertByWhatsapp && r.whatsappNumber) {
    const res = await sendWhatsApp({ to: r.whatsappNumber, ...wa });
    (res.delivered ? channels : failed).push(res.delivered ? "WhatsApp" : `WhatsApp (${res.driver === "console" ? "not configured" : "failed"})`);
  }
  return { name: r.name, channels, failed };
}

async function logOutcome(requestId: string, heading: string, results: Awaited<ReturnType<typeof deliver>>[]) {
  const lines = results.map((r) => {
    const parts = [r.channels.length ? `sent by ${r.channels.join(" + ")}` : "", r.failed.length ? `not sent: ${r.failed.join(", ")}` : ""].filter(Boolean);
    return `• ${r.name}: ${parts.join("; ") || "no alert channel enabled"}`;
  });
  await db.conciergeRequestMessage.create({
    data: { requestId, senderType: "SYSTEM", internalNote: true, message: `${heading}\n${lines.join("\n") || "• Nobody to alert — no active concierge staff."}` },
  });
}

const recipientSelect = { id: true, name: true, email: true, role: true, status: true, conciergeCategories: true, whatsappNumber: true, alertByEmail: true, alertByWhatsapp: true } as const;

/** New member request → the staff responsible for its category (see selectNewRequestRecipients). */
export async function alertNewConciergeRequest(requestId: string) {
  try {
    const request = await db.conciergeRequest.findUnique({ where: { id: requestId }, select: { id: true, reference: true, category: true, subject: true, priority: true } });
    if (!request) return;
    const candidates = (await db.user.findMany({ where: { role: { in: ["CONCIERGE", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" }, select: recipientSelect }))
      .map((u) => ({ ...u, conciergeCategories: conciergeCategoryList(u.conciergeCategories) }));
    const recipients = selectNewRequestRecipients(candidates, request.category);
    const category = CONCIERGE_CATEGORY_LABELS[request.category];
    const url = link(request.id);
    const results = await Promise.all(
      recipients.map((r) =>
        deliver(
          r,
          `New concierge request ${request.reference} · ${category}`,
          `Dear ${r.name},\n\nA new ${category.toLowerCase()} request has arrived.\n\nReference: ${request.reference}\nSubject: ${request.subject}\nPriority: ${request.priority.toLowerCase()}\n\nOpen it in the staff portal:\n${url}\n\nCLUB JOIA 300 Operations`,
          { title: `New concierge request ${request.reference}`, details: `${category} · ${request.subject}`, link: url },
        ),
      ),
    );
    await logOutcome(request.id, "Team alerted about this new request:", results);
  } catch (e) {
    console.error("[staff-alert] new request alert failed:", (e as Error).message);
  }
}

/** Request assigned → the assignee (unless they assigned it to themselves). */
export async function alertConciergeAssignment(requestId: string, assigneeId: string, assignedByUserId: string) {
  if (assigneeId === assignedByUserId) return;
  try {
    const [request, assignee, by] = await Promise.all([
      db.conciergeRequest.findUnique({ where: { id: requestId }, select: { id: true, reference: true, category: true, subject: true, priority: true } }),
      db.user.findUnique({ where: { id: assigneeId }, select: recipientSelect }),
      db.user.findUnique({ where: { id: assignedByUserId }, select: { name: true } }),
    ]);
    if (!request || !assignee || assignee.status !== "ACTIVE") return;
    const category = CONCIERGE_CATEGORY_LABELS[request.category];
    const url = link(request.id);
    const result = await deliver(
      assignee,
      `Assigned to you: ${request.reference} · ${category}`,
      `Dear ${assignee.name},\n\n${by?.name ?? "A colleague"} has assigned a concierge request to you.\n\nReference: ${request.reference}\nCategory: ${category}\nSubject: ${request.subject}\nPriority: ${request.priority.toLowerCase()}\n\nOpen it in the staff portal:\n${url}\n\nCLUB JOIA 300 Operations`,
      { title: `Assigned to you: ${request.reference}`, details: `${category} · ${request.subject}`, link: url },
    );
    await logOutcome(request.id, "Assignment alert:", [result]);
  } catch (e) {
    console.error("[staff-alert] assignment alert failed:", (e as Error).message);
  }
}
