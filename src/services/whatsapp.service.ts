import "server-only";
import { env } from "@/lib/config/env";

/**
 * WhatsAppService — outbound WhatsApp messages to STAFF (operational alerts only; members are
 * not messaged on WhatsApp in V1).
 *   console → logged, NOT delivered (local development default)
 *   twilio  → Twilio WhatsApp API. Business-initiated WhatsApp messages must use a template
 *             approved by Meta: set TWILIO_WHATSAPP_CONTENT_SID (variables {{1}} title, {{2}} details,
 *             {{3}} link). Without it a free-form body is sent, which WhatsApp only delivers inside an
 *             open 24-hour conversation window (or in the Twilio sandbox).
 */
export type WhatsAppMessage = { to: string; title: string; details: string; link: string };
export type WhatsAppDelivery = { delivered: boolean; driver: string; error?: string };

export function whatsappDeliveryConfigured(): boolean {
  return env().WHATSAPP_DRIVER !== "console";
}

export async function sendWhatsApp(message: WhatsAppMessage): Promise<WhatsAppDelivery> {
  const e = env();
  const driver = e.WHATSAPP_DRIVER;
  const body = `${message.title}\n${message.details}\n${message.link}`;
  try {
    switch (driver) {
      case "console":
        console.info(`\n[whatsapp:console] (not delivered — no provider configured)\nTo: ${message.to}\n\n${body}\n`);
        return { delivered: false, driver };
      case "twilio": {
        if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN || !e.TWILIO_WHATSAPP_FROM) throw new Error("Twilio WhatsApp is not configured");
        const form = new URLSearchParams({ From: e.TWILIO_WHATSAPP_FROM, To: `whatsapp:${message.to}` });
        if (e.TWILIO_WHATSAPP_CONTENT_SID) {
          form.set("ContentSid", e.TWILIO_WHATSAPP_CONTENT_SID);
          form.set("ContentVariables", JSON.stringify({ 1: message.title, 2: message.details, 3: message.link }));
        } else {
          form.set("Body", body);
        }
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(e.TWILIO_ACCOUNT_SID)}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Twilio responded ${res.status}`);
        return { delivered: true, driver };
      }
    }
  } catch (err) {
    console.error(`[whatsapp:${driver}] delivery failed:`, (err as Error).message);
    return { delivered: false, driver, error: (err as Error).message };
  }
}
