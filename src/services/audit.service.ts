import "server-only";
import { db, type Tx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "./context";
import { requirePermission } from "./context";

/**
 * AuditService — append-only trail of security- and operations-relevant changes.
 * Writes happen inside the caller's transaction where possible so that an audited
 * change and its audit row commit (or roll back) together.
 */

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

const SENSITIVE_KEYS = new Set(["passwordHash", "mfaSecretEncrypted", "tokenHash", "p256dh", "auth"]);

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SENSITIVE_KEYS.has(k) ? "[redacted]" : v)),
  ) as Prisma.InputJsonValue;
}

export async function recordAudit(
  actor: Pick<Actor, "userId" | "ipAddress" | "userAgent"> | null,
  entry: AuditEntry,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: actor?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      beforeData: scrub(entry.before),
      afterData: scrub(entry.after),
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent?.slice(0, 500) ?? null,
    },
  });
}

export type AuditQuery = {
  entityType?: string;
  action?: string;
  actorUserId?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
};

export async function listAuditLogs(actor: Actor, q: AuditQuery = {}) {
  requirePermission(actor, "audit:view");
  const pageSize = Math.min(q.pageSize ?? 50, 200);
  const page = Math.max(q.page ?? 1, 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.action ? { action: { contains: q.action } } : {}),
    ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
  };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { name: true, email: true, role: true } } },
    }),
    db.auditLog.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function auditEntityTypes(actor: Actor): Promise<string[]> {
  requirePermission(actor, "audit:view");
  const rows = await db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true } });
  return rows.map((r) => r.entityType).sort();
}
