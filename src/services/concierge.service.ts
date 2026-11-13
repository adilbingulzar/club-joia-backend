import "server-only";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { humanCode } from "@/lib/crypto";
import { parseDateOnly } from "@/lib/time";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  canManageConcierge,
  canSeeInternalNotes,
  canViewConciergeRequest,
  CONCIERGE_STATUS_LABELS,
  memberCanCancel,
  memberCanReply,
} from "@/domain/concierge";
import type { ConciergeCategory, ConciergePriority, ConciergeStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "./audit.service";
import { requireMemberActor, requirePermission, type Actor } from "./context";
import { notifyMember } from "./notification.service";
import { storeUpload } from "./storage.service";
import { alertConciergeAssignment, alertNewConciergeRequest } from "./staff-alert.service";
import { runAfterResponse } from "@/lib/background";

/**
 * ConciergeService — member requests and the conversation around them.
 * Every channel (member app, staff portal, and the Phase 3 AI concierge) goes through these
 * functions so permissions, audit and notifications stay consistent.
 */

/** Attachments count against the same per-user upload limit as profile photos. */
async function storeAttachment(actor: Actor, attachment: File) {
  await enforceRateLimit(`upload:${actor.userId}`, RATE_LIMITS.uploadPerUser.limit, RATE_LIMITS.uploadPerUser.window);
  return storeUpload(attachment, "CONCIERGE_ATTACHMENT", actor.userId);
}

export type NewConciergeRequest = {
  category: ConciergeCategory;
  subject: string;
  description: string;
  preferredDate?: string | null;
  preferredTime?: string | null;
  numberOfPeople?: number | null;
  notes?: string | null;
  eventId?: string | null;
};

export async function createRequest(actor: Actor, input: NewConciergeRequest, attachment?: File | null) {
  const memberId = requireMemberActor(actor);
  await enforceRateLimit(`concierge:${memberId}`, RATE_LIMITS.conciergePerMember.limit, RATE_LIMITS.conciergePerMember.window,
    "You have sent a lot of requests in the last hour. Please message concierge on an existing request instead.");
  const upload = attachment && attachment.size > 0 ? await storeAttachment(actor, attachment) : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const request = await tx.conciergeRequest.create({
          data: {
            reference: `JC-${humanCode(6)}`,
            memberId,
            eventId: input.eventId ?? null,
            category: input.category,
            subject: input.subject,
            description: input.description,
            preferredDate: input.preferredDate ? parseDateOnly(input.preferredDate) : null,
            preferredTime: input.preferredTime ?? null,
            numberOfPeople: input.numberOfPeople ?? null,
            notes: input.notes ?? null,
            source: "MEMBER",
          },
        });
        if (upload) {
          await tx.conciergeRequestMessage.create({
            data: {
              requestId: request.id,
              senderId: actor.userId,
              senderType: "MEMBER",
              message: "Attachment",
              attachmentKey: upload.key,
              attachmentName: attachment!.name.slice(0, 120),
            },
          });
        }
        await recordAudit(actor, { action: "concierge.create", entityType: "concierge_request", entityId: request.id, after: { reference: request.reference, category: request.category } }, tx);
        return request;
      });
      // Alert the responsible staff (email / WhatsApp per their preferences) without delaying the member.
      await runAfterResponse(() => alertNewConciergeRequest(created.id));
      return created;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt === 2) throw e;
    }
  }
  throw new AppError("CONFLICT", "Please try again.");
}

export async function listMyRequests(actor: Actor) {
  const memberId = requireMemberActor(actor);
  return db.conciergeRequest.findMany({
    where: { memberId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: { where: { internalNote: false } } } } },
  });
}

/** One request with the conversation the viewer is allowed to see. */
export async function getRequest(actor: Actor, id: string) {
  const request = await db.conciergeRequest.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, membershipNumber: true, mobile: true, dietaryRequirements: true, allergies: true, user: { select: { email: true } }, memberships: { include: { tier: true } } } },
      event: { select: { name: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { name: true, role: true } } },
      },
    },
  });
  if (!request || !canViewConciergeRequest(actor, request)) throw notFound("Request");
  const internal = canSeeInternalNotes(actor.role);
  const messages = request.messages.filter((m) => internal || !m.internalNote);
  if (actor.role === "MEMBER") {
    // Members see staff as "CLUB JOIA Concierge", not individual staff names.
    return {
      ...request,
      member: undefined,
      messages: messages.map((m) => ({ ...m, sender: m.senderType === "MEMBER" ? { name: "You", role: "MEMBER" as const } : { name: "CLUB JOIA Concierge", role: null } })),
      assignedTo: null,
    };
  }
  return { ...request, messages };
}

export async function addMessage(actor: Actor, requestId: string, input: { message: string; internalNote?: boolean }, attachment?: File | null) {
  await enforceRateLimit(`concierge-msg:${actor.userId}`, RATE_LIMITS.conciergeMessagePerUser.limit, RATE_LIMITS.conciergeMessagePerUser.window);
  const request = await db.conciergeRequest.findUnique({ where: { id: requestId } });
  if (!request || !canViewConciergeRequest(actor, request)) throw notFound("Request");
  const isStaff = canManageConcierge(actor.role);
  if (!isStaff) {
    if (input.internalNote) throw new AppError("FORBIDDEN", "Not allowed.");
    if (!memberCanReply(request.status)) throw new AppError("INVALID_STATE", "This request is closed. Please open a new request.");
  }
  const upload = attachment && attachment.size > 0 ? await storeAttachment(actor, attachment) : null;
  const internal = Boolean(isStaff && input.internalNote);

  await db.$transaction(async (tx) => {
    await tx.conciergeRequestMessage.create({
      data: {
        requestId,
        senderId: actor.userId,
        senderType: isStaff ? "STAFF" : "MEMBER",
        message: input.message,
        internalNote: internal,
        attachmentKey: upload?.key ?? null,
        attachmentName: upload ? attachment!.name.slice(0, 120) : null,
      },
    });
    // A member reply moves "waiting for member" back to the concierge team.
    const nextStatus: ConciergeStatus | undefined = !isStaff && request.status === "WAITING_FOR_MEMBER" ? "IN_PROGRESS" : undefined;
    await tx.conciergeRequest.update({ where: { id: requestId }, data: { updatedAt: new Date(), ...(nextStatus ? { status: nextStatus } : {}) } });
  });

  if (isStaff && !internal) {
    await notifyMember(request.memberId, {
      title: "Concierge replied",
      body: `New message on “${request.subject}”.`,
      type: "CONCIERGE",
      url: `/concierge/${request.id}`,
    });
  }
}

export async function updateStatus(actor: Actor, requestId: string, status: ConciergeStatus) {
  requirePermission(actor, "concierge:manage");
  const before = await db.conciergeRequest.findUnique({ where: { id: requestId } });
  if (!before) throw notFound("Request");
  if (before.status === status) return;
  await db.$transaction(async (tx) => {
    await tx.conciergeRequest.update({
      where: { id: requestId },
      data: { status, closedAt: status === "COMPLETED" || status === "CANCELLED" ? new Date() : null },
    });
    await tx.conciergeRequestMessage.create({
      data: { requestId, senderType: "SYSTEM", message: `Status changed to ${CONCIERGE_STATUS_LABELS[status]}.` },
    });
    await recordAudit(actor, { action: "concierge.status", entityType: "concierge_request", entityId: requestId, before: { status: before.status }, after: { status } }, tx);
  });
  const messages: Partial<Record<ConciergeStatus, string>> = {
    CONFIRMED: `Your concierge request “${before.subject}” has been confirmed.`,
    WAITING_FOR_MEMBER: `Concierge needs a little more information on “${before.subject}”.`,
    COMPLETED: `Your concierge request “${before.subject}” is complete.`,
  };
  if (messages[status]) {
    await notifyMember(before.memberId, { title: "Concierge update", body: messages[status]!, type: "CONCIERGE", url: `/concierge/${requestId}` });
  }
}

export async function cancelMyRequest(actor: Actor, requestId: string) {
  const memberId = requireMemberActor(actor);
  const request = await db.conciergeRequest.findUnique({ where: { id: requestId } });
  if (!request || request.memberId !== memberId) throw notFound("Request");
  if (!memberCanCancel(request.status)) throw new AppError("INVALID_STATE", "This request can no longer be cancelled here. Please message concierge.");
  await db.$transaction(async (tx) => {
    await tx.conciergeRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", closedAt: new Date() } });
    await tx.conciergeRequestMessage.create({ data: { requestId, senderType: "SYSTEM", message: "Cancelled by member." } });
    await recordAudit(actor, { action: "concierge.member_cancel", entityType: "concierge_request", entityId: requestId, before: { status: request.status } }, tx);
  });
}

export async function assignRequest(actor: Actor, requestId: string, assigneeId: string | null) {
  requirePermission(actor, "concierge:manage");
  if (assigneeId) {
    const assignee = await db.user.findUnique({ where: { id: assigneeId } });
    if (!assignee || !["CONCIERGE", "ADMIN", "SUPER_ADMIN"].includes(assignee.role) || assignee.status !== "ACTIVE") {
      throw new AppError("VALIDATION", "Assign to an active concierge team member.");
    }
  }
  const before = await db.conciergeRequest.findUnique({ where: { id: requestId } });
  if (!before) throw notFound("Request");
  await db.conciergeRequest.update({
    where: { id: requestId },
    data: { assignedToId: assigneeId, ...(before.status === "NEW" && assigneeId ? { status: "IN_PROGRESS" } : {}) },
  });
  await recordAudit(actor, { action: "concierge.assign", entityType: "concierge_request", entityId: requestId, before: { assignedToId: before.assignedToId }, after: { assignedToId: assigneeId } });
  if (assigneeId) await runAfterResponse(() => alertConciergeAssignment(requestId, assigneeId, actor.userId));
}

export async function setPriority(actor: Actor, requestId: string, priority: ConciergePriority) {
  requirePermission(actor, "concierge:manage");
  await db.conciergeRequest.update({ where: { id: requestId }, data: { priority } });
  await recordAudit(actor, { action: "concierge.priority", entityType: "concierge_request", entityId: requestId, after: { priority } });
}

export type ConciergeQuery = {
  status?: ConciergeStatus | "OPEN";
  category?: ConciergeCategory;
  assignedTo?: string | "me" | "unassigned";
  q?: string;
  page?: number;
};

export async function listRequestsStaff(actor: Actor, query: ConciergeQuery = {}) {
  requirePermission(actor, "concierge:view_all");
  const page = Math.max(query.page ?? 1, 1);
  const q = query.q?.trim();
  const where: Prisma.ConciergeRequestWhereInput = {
    ...(query.status === "OPEN"
      ? { status: { in: ["NEW", "IN_PROGRESS", "WAITING_FOR_MEMBER", "CONFIRMED"] } }
      : query.status
        ? { status: query.status }
        : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.assignedTo === "me"
      ? { assignedToId: actor.userId }
      : query.assignedTo === "unassigned"
        ? { assignedToId: null }
        : query.assignedTo
          ? { assignedToId: query.assignedTo }
          : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q } },
            { subject: { contains: q } },
            { member: { lastName: { contains: q } } },
            { member: { firstName: { contains: q } } },
          ],
        }
      : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db.conciergeRequest.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * 30,
      take: 30,
      include: {
        member: { select: { firstName: true, lastName: true, membershipNumber: true, memberships: { include: { tier: true } } } },
        assignedTo: { select: { name: true } },
      },
    }),
    db.conciergeRequest.count({ where }),
    db.conciergeRequest.groupBy({ by: ["status"], _count: true }),
  ]);
  return { rows, total, page, pageSize: 30, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<ConciergeStatus, number>> };
}

export async function listConciergeTeam() {
  return db.user.findMany({
    where: { role: { in: ["CONCIERGE", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}
