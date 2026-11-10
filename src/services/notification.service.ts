import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import type { Prisma } from "@/generated/prisma/client";
import type { DeliveryChannel, NotificationTargetType, NotificationType } from "@/generated/prisma/enums";
import { recordAudit } from "./audit.service";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { CHANNEL_ADAPTERS, V1_CHANNELS } from "./notifications/channels";

/**
 * NotificationService — compose, target, schedule and deliver notifications.
 * IN_APP delivery is a recipient row (the notification centre reads it). Other channels go
 * through adapters in ./notifications/channels.ts.
 */

export type NotificationInput = {
  title: string;
  body: string;
  type: NotificationType;
  targetType: NotificationTargetType;
  targetId?: string | null;
  eventId?: string | null;
  url?: string | null;
  channels: DeliveryChannel[];
  scheduledAt?: Date | null;
};

type MemberPrefs = { notifications?: { push?: boolean } };

async function resolveAudience(targetType: NotificationTargetType, targetId: string | null) {
  let where: Prisma.MemberWhereInput;
  switch (targetType) {
    case "ALL_MEMBERS":
      where = { memberships: { some: { status: "ACTIVE" } } };
      break;
    case "TIER":
      if (!targetId) throw new AppError("VALIDATION", "Choose a tier.");
      where = { memberships: { some: { status: "ACTIVE", tierId: targetId } } };
      break;
    case "EVENT":
      if (!targetId) throw new AppError("VALIDATION", "Choose an event.");
      where = {
        memberships: { some: { status: "ACTIVE" } },
        tickets: { some: { eventId: targetId, status: { in: ["ACTIVE", "USED"] } } },
      };
      break;
    case "MEMBER":
      if (!targetId) throw new AppError("VALIDATION", "Choose a member.");
      where = { id: targetId };
      break;
  }
  return db.member.findMany({
    where: { ...where, anonymizedAt: null, user: { status: "ACTIVE" } },
    select: { id: true, userId: true, preferences: true },
  });
}

export async function previewAudienceSize(actor: Actor, targetType: NotificationTargetType, targetId: string | null) {
  requirePermission(actor, "notifications:send");
  return (await resolveAudience(targetType, targetId)).length;
}

/** Deliver a notification now. Safe to call concurrently: only one caller claims it. */
export async function dispatchNotification(notificationId: string) {
  const claimed = await db.notification.updateMany({
    where: { id: notificationId, status: { in: ["DRAFT", "SCHEDULED"] } },
    data: { status: "SENDING" },
  });
  if (claimed.count !== 1) return { dispatched: false as const };

  const n = await db.notification.findUniqueOrThrow({ where: { id: notificationId } });
  try {
    const audience = await resolveAudience(n.targetType, n.targetId);
    const now = new Date();

    if (n.channels.includes("IN_APP")) {
      await db.notificationRecipient.createMany({
        data: audience.map((m) => ({
          notificationId: n.id,
          memberId: m.id,
          deliveryChannel: "IN_APP" as const,
          deliveryStatus: "SENT" as const,
          sentAt: now,
        })),
        skipDuplicates: true,
      });
    }

    for (const channel of n.channels.filter((c) => c !== "IN_APP")) {
      const adapter = CHANNEL_ADAPTERS[channel];
      const eligible = audience.filter((m) =>
        channel === "WEB_PUSH" ? (m.preferences as MemberPrefs)?.notifications?.push !== false : true,
      );
      const skipped = audience.filter((m) => !eligible.includes(m));
      const results =
        adapter && adapter.configured()
          ? await adapter.send(
              eligible.map((m) => ({ memberId: m.id, userId: m.userId })),
              { title: n.title, body: n.body, url: n.url, tag: n.id },
            )
          : eligible.map((m) => ({ memberId: m.id, ok: false, error: `${channel} not configured` }));

      await db.notificationRecipient.createMany({
        data: [
          ...results.map((r) => ({
            notificationId: n.id,
            memberId: r.memberId,
            deliveryChannel: channel,
            deliveryStatus: r.ok ? ("SENT" as const) : ("SKIPPED" as const),
            error: r.error?.slice(0, 200),
            sentAt: r.ok ? now : null,
          })),
          ...skipped.map((m) => ({
            notificationId: n.id,
            memberId: m.id,
            deliveryChannel: channel,
            deliveryStatus: "SKIPPED" as const,
            error: "Member opted out",
          })),
        ],
        skipDuplicates: true,
      });
    }

    await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: now } });
    return { dispatched: true as const, recipients: audience.length };
  } catch (err) {
    await db.notification.update({
      where: { id: n.id },
      data: { status: "FAILED", metadata: { ...(n.metadata as object), error: String(err).slice(0, 300) } },
    });
    throw err;
  }
}

/** System-generated notification to one member (ticket issued, concierge update...). Never throws. */
export async function notifyMember(
  memberId: string,
  msg: { title: string; body: string; type: NotificationType; url?: string; eventId?: string | null },
) {
  try {
    const n = await db.notification.create({
      data: {
        title: msg.title,
        body: msg.body,
        type: msg.type,
        url: msg.url,
        eventId: msg.eventId ?? null,
        targetType: "MEMBER",
        targetId: memberId,
        channels: V1_CHANNELS,
        status: "DRAFT",
        metadata: { system: true },
      },
    });
    await dispatchNotification(n.id);
  } catch (err) {
    console.error("[notifyMember] failed", err);
  }
}

export async function createNotification(actor: Actor, input: NotificationInput) {
  requirePermission(actor, "notifications:send");
  const channels = input.channels.filter((c) => V1_CHANNELS.includes(c));
  if (channels.length === 0) throw new AppError("VALIDATION", "Choose at least one delivery channel.");
  if (input.targetType !== "ALL_MEMBERS" && !input.targetId) throw new AppError("VALIDATION", "Choose who should receive this.");
  if (input.url && (!input.url.startsWith("/") || input.url.startsWith("//"))) {
    throw new AppError("VALIDATION", "Links must be in-app paths such as /events.");
  }
  const scheduled = input.scheduledAt && input.scheduledAt.getTime() > Date.now() + 30_000;
  const n = await db.notification.create({
    data: {
      title: input.title,
      body: input.body,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetType === "ALL_MEMBERS" ? null : input.targetId,
      eventId: input.eventId ?? (input.targetType === "EVENT" ? input.targetId : null),
      url: input.url || null,
      channels,
      scheduledAt: scheduled ? input.scheduledAt : null,
      status: scheduled ? "SCHEDULED" : "DRAFT",
      createdById: actor.userId,
    },
  });
  await recordAudit(actor, {
    action: scheduled ? "notification.schedule" : "notification.send",
    entityType: "notification",
    entityId: n.id,
    after: { title: n.title, targetType: n.targetType, targetId: n.targetId, channels, scheduledAt: n.scheduledAt },
  });
  if (!scheduled) await dispatchNotification(n.id);
  return n;
}

export async function cancelScheduledNotification(actor: Actor, id: string) {
  requirePermission(actor, "notifications:send");
  const res = await db.notification.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
  if (res.count !== 1) throw new AppError("INVALID_STATE", "Only scheduled notifications can be cancelled.");
  await recordAudit(actor, { action: "notification.cancel", entityType: "notification", entityId: id });
}

/** Called by the cron route. Returns how many were sent. */
export async function processDueNotifications(now = new Date()) {
  const due = await db.notification.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    select: { id: true },
    take: 50,
  });
  let sent = 0;
  for (const { id } of due) {
    try {
      if ((await dispatchNotification(id)).dispatched) sent++;
    } catch (err) {
      console.error(`[cron] notification ${id} failed`, err);
    }
  }
  return { due: due.length, sent };
}

export async function listNotificationsAdmin(actor: Actor, opts: { page?: number } = {}) {
  requirePermission(actor, "notifications:send");
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    db.notification.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 30,
      take: 30,
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { recipients: true } },
      },
    }),
    db.notification.count(),
  ]);
  const ids = rows.map((r) => r.id);
  const stats = await db.notificationRecipient.groupBy({
    by: ["notificationId", "deliveryChannel", "deliveryStatus"],
    where: { notificationId: { in: ids } },
    _count: true,
  });
  const reads = await db.notificationRecipient.groupBy({
    by: ["notificationId"],
    where: { notificationId: { in: ids }, deliveryChannel: "IN_APP", readAt: { not: null } },
    _count: true,
  });
  return {
    total,
    page,
    rows: rows.map((r) => ({
      ...r,
      stats: stats.filter((s) => s.notificationId === r.id),
      reads: reads.find((x) => x.notificationId === r.id)?._count ?? 0,
    })),
  };
}

// ─── Member notification centre ─────────────────────────────────────────────

export async function listMyNotifications(actor: Actor, limit = 50) {
  const memberId = requireMemberActor(actor);
  const rows = await db.notificationRecipient.findMany({
    where: { memberId, deliveryChannel: "IN_APP" },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { notification: { select: { title: true, body: true, type: true, url: true, sentAt: true, createdAt: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.notification.title,
    body: r.notification.body,
    type: r.notification.type,
    url: r.notification.url,
    at: r.notification.sentAt ?? r.notification.createdAt,
    read: Boolean(r.readAt),
  }));
}

export async function unreadCount(actor: Actor) {
  if (!actor.memberId) return 0;
  return db.notificationRecipient.count({ where: { memberId: actor.memberId, deliveryChannel: "IN_APP", readAt: null } });
}

export async function markNotificationsRead(actor: Actor, recipientId?: string) {
  const memberId = requireMemberActor(actor);
  await db.notificationRecipient.updateMany({
    where: { memberId, deliveryChannel: "IN_APP", readAt: null, ...(recipientId ? { id: recipientId } : {}) },
    data: { readAt: new Date() },
  });
}

// ─── Push subscriptions ─────────────────────────────────────────────────────

export async function savePushSubscription(
  actor: Actor,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  if (!actor.memberId) throw new AppError("FORBIDDEN", "Push notifications are for members.");
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      userId: actor.userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: actor.userAgent?.slice(0, 300),
    },
    update: { userId: actor.userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, disabledAt: null, failureCount: 0 },
  });
  await db.consentRecord.create({
    data: { userId: actor.userId, type: "PUSH_NOTIFICATIONS", version: "v1", granted: true, ipAddress: actor.ipAddress, userAgent: actor.userAgent?.slice(0, 500) },
  });
}

export async function removePushSubscription(actor: Actor, endpoint: string) {
  await db.pushSubscription.updateMany({ where: { endpoint, userId: actor.userId }, data: { disabledAt: new Date() } });
}

export async function getNotificationOrThrow(actor: Actor, id: string) {
  requirePermission(actor, "notifications:send");
  const n = await db.notification.findUnique({ where: { id } });
  if (!n) throw notFound("Notification");
  return n;
}
