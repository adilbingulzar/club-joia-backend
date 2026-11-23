import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/config/env";
import { AppError } from "@/lib/errors";

/**
 * EmailService — transport abstraction.
 *   console  → written to the server log, NOT delivered (local development default)
 *   postmark → Postmark HTTP API via POSTMARK_SERVER_TOKEN (+ POSTMARK_MESSAGE_STREAM)
 *   smtp     → any SMTP server (Microsoft 365, Google Workspace, SES, Postmark, Mailgun…) via SMTP_URL
 *   resend   → Resend HTTP API via RESEND_API_KEY
 * While the console driver is active, admin screens show activation / reset links directly
 * so operations are never blocked.
 *
 * Every message carries a plain-text body and, when built with composeEmail(), a branded HTML body.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Short category for the provider's reporting (Postmark Tag), e.g. "activation". */
  tag?: string;
};

export type EmailDelivery = { delivered: boolean; driver: string; error?: string };

export function emailDeliveryConfigured(): boolean {
  return env().EMAIL_DRIVER !== "console";
}

let smtp: Transporter | undefined;
function smtpTransport() {
  const url = env().SMTP_URL;
  if (!url) throw new AppError("NOT_CONFIGURED", "SMTP_URL is not set.");
  return (smtp ??= nodemailer.createTransport(url));
}

async function sendViaPostmark(message: EmailMessage) {
  const e = env();
  if (!e.POSTMARK_SERVER_TOKEN) throw new AppError("NOT_CONFIGURED", "POSTMARK_SERVER_TOKEN is not set.");
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": e.POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      From: e.EMAIL_FROM,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      Tag: message.tag,
      MessageStream: e.POSTMARK_MESSAGE_STREAM,
      // Sign-in links must reach the member untouched: no click-tracking redirects, no tracking pixel.
      TrackLinks: "None",
      TrackOpens: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { ErrorCode?: number; Message?: string } | null;
    throw new Error(`Postmark responded ${res.status}${body?.Message ? ` (${body.ErrorCode}: ${body.Message})` : ""}`);
  }
}

export async function sendEmail(message: EmailMessage): Promise<EmailDelivery> {
  const e = env();
  const driver = e.EMAIL_DRIVER;
  try {
    switch (driver) {
      case "console":
        console.info(
          `\n[email:console] (not delivered — no provider configured)\nFrom: ${e.EMAIL_FROM}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
        );
        return { delivered: false, driver };
      case "postmark":
        await sendViaPostmark(message);
        return { delivered: true, driver };
      case "smtp":
        await smtpTransport().sendMail({ from: e.EMAIL_FROM, to: message.to, subject: message.subject, text: message.text, html: message.html });
        return { delivered: true, driver };
      case "resend": {
        if (!e.RESEND_API_KEY) throw new AppError("NOT_CONFIGURED", "RESEND_API_KEY is not set.");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: e.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Resend responded ${res.status}`);
        return { delivered: true, driver };
      }
    }
  } catch (err) {
    // Never leak provider errors to callers' users; log for operators.
    console.error(`[email:${driver}] delivery to ${message.to} failed:`, (err as Error).message);
    return { delivered: false, driver, error: (err as Error).message };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Templates
 * ---------------------------------------------------------------------------------------------- */

export type EmailContent = Omit<EmailMessage, "to">;

export type EmailParts = {
  subject: string;
  tag?: string;
  /** Hidden inbox preview line. */
  preheader?: string;
  greeting: string;
  /** Paragraphs before the button. */
  intro: string[];
  /** Label / value rows, e.g. a request reference. */
  details?: [string, string][];
  action?: { label: string; url: string };
  /** Paragraphs after the button (expiry, "ignore this if…"). */
  outro?: string[];
  signOff: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

/** Builds matching plain-text and HTML bodies from the same parts. All values are escaped. */
export function composeEmail(parts: EmailParts): EmailContent {
  const text = [
    parts.greeting,
    ...parts.intro,
    ...(parts.details?.length ? [parts.details.map(([k, v]) => `${k}: ${v}`).join("\n")] : []),
    ...(parts.action ? [`${parts.action.label}:\n${parts.action.url}`] : []),
    ...(parts.outro ?? []),
    parts.signOff,
  ].join("\n\n");

  const p = (s: string) => `<p style="margin:0 0 16px;font:15px/1.6 ${FONT};color:#2B2B2B;">${escapeHtml(s)}</p>`;
  const details = parts.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 20px;border-top:1px solid #E7E4DC;">${parts.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid #E7E4DC;font:13px/1.4 ${FONT};color:#8F8B82;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:10px 0;border-bottom:1px solid #E7E4DC;font:14px/1.4 ${FONT};color:#050505;">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const action = parts.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:#050505;border-radius:999px;">
<a href="${escapeHtml(parts.action.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font:600 14px/1 ${FONT};letter-spacing:.04em;color:#F5F3EE;text-decoration:none;border-radius:999px;">${escapeHtml(parts.action.label)}</a>
</td></tr></table>
<p style="margin:0 0 20px;font:12px/1.5 ${FONT};color:#8F8B82;">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(parts.action.url)}" style="color:#A3101F;word-break:break-all;">${escapeHtml(parts.action.url)}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(parts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F5F3EE;">
${parts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(parts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EE;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="background:#050505;border-radius:18px 18px 0 0;padding:28px 32px;">
<div style="font:400 22px/1 ${SERIF};letter-spacing:.18em;color:#F5F3EE;">CLUB JOIA <span style="color:#EF233C;">300</span></div>
</td></tr>
<tr><td style="background:#FFFFFF;border-radius:0 0 18px 18px;padding:32px;">
${p(parts.greeting)}
${parts.intro.map(p).join("\n")}
${details}
${action}
${(parts.outro ?? []).map(p).join("\n")}
<p style="margin:24px 0 0;font:15px/1.6 ${FONT};color:#2B2B2B;">${escapeHtml(parts.signOff)}</p>
</td></tr>
<tr><td style="padding:20px 32px;text-align:center;font:11px/1.5 ${FONT};color:#8F8B82;">CLUB JOIA 300 · This is an automated message.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: parts.subject, text, html, tag: parts.tag };
}

export function activationEmail(name: string, link: string): EmailContent {
  return composeEmail({
    subject: "Your CLUB JOIA 300 membership is ready",
    tag: "activation",
    preheader: "Activate your private member account.",
    greeting: `Dear ${name},`,
    intro: ["Welcome to CLUB JOIA 300. Your private member account is ready. Activate it and choose your password here:"],
    action: { label: "Activate my account", url: link },
    outro: ["This link expires in 72 hours."],
    signOff: "CLUB JOIA 300 Concierge",
  });
}

export function passwordResetEmail(name: string, link: string): EmailContent {
  return composeEmail({
    subject: "Reset your CLUB JOIA 300 password",
    tag: "password-reset",
    preheader: "Choose a new password for your account.",
    greeting: `Dear ${name},`,
    intro: ["A password reset was requested for your account. Choose a new password here:"],
    action: { label: "Choose a new password", url: link },
    outro: ["This link expires in 60 minutes. If you did not request this, you can ignore this email."],
    signOff: "CLUB JOIA 300 Concierge",
  });
}
