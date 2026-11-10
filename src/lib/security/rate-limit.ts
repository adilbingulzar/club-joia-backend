import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";

/**
 * Fixed-window rate limiter backed by PostgreSQL (one atomic upsert per hit), so limits are
 * shared across all serverless instances. Keys are hashed so no emails/IPs are stored raw.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const hashed = sha256(key);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "window_start")
    VALUES (${hashed}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_buckets"."window_start" < now() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
      "window_start" = CASE WHEN "rate_limit_buckets"."window_start" < now() - make_interval(secs => ${windowSeconds})
                     THEN now() ELSE "rate_limit_buckets"."window_start" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? limit + 1);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  const { allowed } = await hitRateLimit(key, limit, windowSeconds);
  if (!allowed) {
    throw new AppError("RATE_LIMITED", message ?? "Too many attempts. Please wait a few minutes and try again.");
  }
}

export const RATE_LIMITS = {
  loginPerEmail: { limit: 8, window: 15 * 60 },
  loginPerIp: { limit: 40, window: 15 * 60 },
  passwordResetPerEmail: { limit: 3, window: 60 * 60 },
  passwordResetPerIp: { limit: 20, window: 60 * 60 },
  activationPerIp: { limit: 20, window: 60 * 60 },
  conciergePerMember: { limit: 20, window: 60 * 60 },
  conciergeMessagePerUser: { limit: 60, window: 60 * 60 },
  qrIssuePerUser: { limit: 120, window: 60 * 60 },
  scanPerStaff: { limit: 1200, window: 60 * 60 },
  uploadPerUser: { limit: 30, window: 60 * 60 },
  exportPerUser: { limit: 5, window: 24 * 60 * 60 },
} as const;
