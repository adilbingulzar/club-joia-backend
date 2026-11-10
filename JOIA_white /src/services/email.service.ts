import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/config/env";
import { AppError } from "@/lib/errors";

/**
 * EmailService — transport abstraction.
 *   console → written to the server log, NOT delivered (local development default)
 *   smtp    → any SMTP server (Microsoft 365, Google Workspace, SES, Postmark, Mailgun…) via SMTP_URL
 *   resend  → Resend HTTP API via RESEND_API_KEY
 * While the console driver is active, admin screens show activation / reset links directly
 * so operations are never blocked.
 */
export type EmailMessage = { to: string; subject: string; text: string };

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
      case "smtp":
        await smtpTransport().sendMail({ from: e.EMAIL_FROM, to: message.to, subject: message.subject, text: message.text });
        return { delivered: true, driver };
      case "resend": {
        if (!e.RESEND_API_KEY) throw new AppError("NOT_CONFIGURED", "RESEND_API_KEY is not set.");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: e.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
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

export function activationEmail(name: string, link: string): Omit<EmailMessage, "to"> {
  return {
    subject: "Your CLUB JOIA 300 membership is ready",
    text: `Dear ${name},\n\nWelcome to CLUB JOIA 300. Activate your private member account here:\n\n${link}\n\nThis link expires in 72 hours.\n\nCLUB JOIA 300 Concierge`,
  };
}

export function passwordResetEmail(name: string, link: string): Omit<EmailMessage, "to"> {
  return {
    subject: "Reset your CLUB JOIA 300 password",
    text: `Dear ${name},\n\nA password reset was requested for your account. Choose a new password here:\n\n${link}\n\nThis link expires in 60 minutes. If you did not request this, you can ignore this email.\n\nCLUB JOIA 300 Concierge`,
  };
}
