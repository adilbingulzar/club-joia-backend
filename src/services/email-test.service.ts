import "server-only";
import { env } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { recordAudit } from "./audit.service";
import { requirePermission, type Actor } from "./context";
import { sendEmail } from "./email.service";

/**
 * A plain test email from the admin's hidden page /admin/email-test (super admins), to check that
 * email sending works and where the mail lands, without creating staff or members.
 */

const PER_HOUR = 20;

/** What the page shows about the email settings (never the token itself). */
export function emailSettings(actor: Actor) {
  requirePermission(actor, "settings:manage");
  const e = env();
  return { driver: e.EMAIL_DRIVER, from: e.EMAIL_FROM, stream: e.POSTMARK_MESSAGE_STREAM, postmarkToken: Boolean(e.POSTMARK_SERVER_TOKEN) };
}

export async function sendTestEmail(actor: Actor, input: { to: string; subject: string; text: string }) {
  requirePermission(actor, "settings:manage");
  const { allowed } = await hitRateLimit(`email-test:${actor.userId}`, PER_HOUR, 60 * 60);
  if (!allowed) throw new AppError("RATE_LIMITED", `That's ${PER_HOUR} test emails this hour. Please wait a while.`);
  const r = await sendEmail({ to: input.to, subject: input.subject, text: input.text, tag: "test" });
  await recordAudit(actor, { action: "email.test_sent", entityType: "email", after: { to: input.to, driver: r.driver, delivered: r.delivered, error: r.error ?? null } });
  if (r.error) throw new AppError("INVALID_STATE", `Not sent. ${r.driver} said: ${r.error}`);
  if (!r.delivered) throw new AppError("NOT_CONFIGURED", "Not sent: email sending is off (EMAIL_DRIVER=console). The email was only written to the server log.");
  return r;
}
