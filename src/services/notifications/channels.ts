import "server-only";
import webpush from "web-push";
import { db } from "@/lib/db";
import { env } from "@/lib/config/env";
import type { DeliveryChannel } from "@/generated/prisma/enums";

/**
 * Delivery channel adapters. NotificationService fans a notification out to recipients and
 * hands each channel the members it should reach. Adding EMAIL / SMS / WHATSAPP / native push
 * later means implementing one adapter here — no changes to callers.
 */
export type OutboundMessage = { title: string; body: string; url?: string | null; tag?: string };

export type ChannelResult = { memberId: string; ok: boolean; error?: string };

export interface ChannelAdapter {
  channel: DeliveryChannel;
  configured(): boolean;
  send(members: { memberId: string; userId: string }[], message: OutboundMessage): Promise<ChannelResult[]>;
}

/** Web Push (VAPID) to every active browser subscription of each member. */
const webPushAdapter: ChannelAdapter = {
  channel: "WEB_PUSH",
  configured() {
    const e = env();
    return Boolean(e.WEB_PUSH_PUBLIC_KEY && e.WEB_PUSH_PRIVATE_KEY);
  },
  async send(members, message) {
    const e = env();
    webpush.setVapidDetails(e.WEB_PUSH_SUBJECT, e.WEB_PUSH_PUBLIC_KEY!, e.WEB_PUSH_PRIVATE_KEY!);
    const subs = await db.pushSubscription.findMany({
      where: { userId: { in: members.map((m) => m.userId) }, disabledAt: null },
    });
    const byUser = new Map<string, typeof subs>();
    for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
    const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url ?? "/notifications", tag: message.tag });

    return Promise.all(
      members.map(async ({ memberId, userId }) => {
        const userSubs = byUser.get(userId) ?? [];
        if (userSubs.length === 0) return { memberId, ok: false, error: "No push subscription" };
        let delivered = 0;
        let lastError = "";
        for (const sub of userSubs) {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
              TTL: 60 * 60,
              urgency: "high",
            });
            delivered++;
            await db.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date(), failureCount: 0 } });
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            lastError = `push ${status ?? "error"}`;
            // 404/410 = subscription gone (uninstalled / permission revoked).
            await db.pushSubscription.update({
              where: { id: sub.id },
              data:
                status === 404 || status === 410
                  ? { disabledAt: new Date() }
                  : { failureCount: { increment: 1 }, ...(sub.failureCount >= 4 ? { disabledAt: new Date() } : {}) },
            });
          }
        }
        return delivered > 0 ? { memberId, ok: true } : { memberId, ok: false, error: lastError };
      }),
    );
  },
};

function notConfigured(channel: DeliveryChannel): ChannelAdapter {
  return {
    channel,
    configured: () => false,
    async send(members) {
      return members.map((m) => ({ memberId: m.memberId, ok: false, error: `${channel} channel not implemented in V1` }));
    },
  };
}

export const CHANNEL_ADAPTERS: Partial<Record<DeliveryChannel, ChannelAdapter>> = {
  WEB_PUSH: webPushAdapter,
  EMAIL: notConfigured("EMAIL"),
  SMS: notConfigured("SMS"),
  WHATSAPP: notConfigured("WHATSAPP"),
  APPLE_PUSH: notConfigured("APPLE_PUSH"),
  ANDROID_PUSH: notConfigured("ANDROID_PUSH"),
};

/** Channels an admin can choose in V1. */
export const V1_CHANNELS: DeliveryChannel[] = ["IN_APP", "WEB_PUSH"];
