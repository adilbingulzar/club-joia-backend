import "server-only";
import { db } from "@/lib/db";
import { conciergeCategoryList } from "@/lib/json-list";
import { env } from "@/lib/config/env";
import { CONCIERGE_CATEGORY_LABELS, selectNewRequestRecipients } from "@/domain/concierge";
import { composeEmail, sendEmail, type EmailContent } from "./email.service";

/**
 * StaffAlertService — operational alerts to staff by email, according to each person's
 * preferences (Admin → Staff). Alerts are best-effort: a provider failure never blocks
 * the member's request. The outcome is recorded as an internal (staff-only) note on the request.
 *
 * Alert content is deliberately minimal (reference, category, subject, link) — member details stay
 * behind the staff portal sign-in.
 */

type Recipient = { id: string; name: string; email: string; alertByEmail: boolean };

const link = (requestId: string) => new URL(`/admin/concierge/${requestId}`, env().NEXT_PUBLIC_APP_URL).toString();

async function deliver(r: Recipient, email: EmailContent) {
  const channels: string[] = [];
  const failed: string[] = [];
  if (r.alertByEmail) {
    const res = await sendEmail({ to: r.email, ...email });
    (res.delivered ? channels : failed).push(res.delivered ? "email" : `email (${res.driver === "console" ? "not configured" : "failed"})`);
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

const recipientSelect = { id: true, name: true, email: true, role: true, status: true, conciergeCategories: true, alertByEmail: true } as const;

/** New member request → the staff responsible for its category (see selectNewRequestRecipients). */
export async function alertNewConciergeRequest(requestId: string) {
  try {
    const request = await db.conciergeRequest.findUnique({ where: { id: requestId }, select: { id: true, reference: true, category: true, subject: true, priority: true } });
    if (!request) return;
    const candidates = (await db.user.findMany({ where: { role: { in: ["CONCIERGE", "BACKOFFICE", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" }, select: recipientSelect }))
      .map((u) => ({ ...u, conciergeCategories: conciergeCategoryList(u.conciergeCategories) }));
    const recipients = selectNewRequestRecipients(candidates, request.category);
    const category = CONCIERGE_CATEGORY_LABELS[request.category];
    const url = link(request.id);
    const results = await Promise.all(
      recipients.map((r) =>
        deliver(
          r,
          composeEmail({
            subject: `New concierge request ${request.reference} · ${category}`,
            tag: "staff-alert",
            preheader: `${category} · ${request.subject}`,
            greeting: `Dear ${r.name},`,
            intro: [`A new ${category.toLowerCase()} request has arrived.`],
            details: [
              ["Reference", request.reference],
              ["Subject", request.subject],
              ["Priority", request.priority.toLowerCase()],
            ],
            action: { label: "Open in the staff portal", url },
            signOff: "CLUB JOIA 300 Operations",
          }),
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
      composeEmail({
        subject: `Assigned to you: ${request.reference} · ${category}`,
        tag: "staff-alert",
        preheader: `${category} · ${request.subject}`,
        greeting: `Dear ${assignee.name},`,
        intro: [`${by?.name ?? "A colleague"} has assigned a concierge request to you.`],
        details: [
          ["Reference", request.reference],
          ["Category", category],
          ["Subject", request.subject],
          ["Priority", request.priority.toLowerCase()],
        ],
        action: { label: "Open in the staff portal", url },
        signOff: "CLUB JOIA 300 Operations",
      }),
    );
    await logOutcome(request.id, "Assignment alert:", [result]);
  } catch (e) {
    console.error("[staff-alert] assignment alert failed:", (e as Error).message);
  }
}
