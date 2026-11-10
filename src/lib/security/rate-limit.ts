import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";

/**
 * Fixed-window rate limiter backed by MySQL, so limits are shared by every app process.
 * Keys are hashed so no emails/IPs are stored raw.
 *
 * One atomic upsert per hit. MySQL has no `RETURNING`, so the upsert and the read-back run in one
 * transaction: the upsert keeps the row locked until commit, so concurrent hits on the same key
 * queue up and each reads its own count. In ON DUPLICATE KEY UPDATE, assignments apply left to
 * right, so `count` is computed from the old `window_start` before that column is reset.
 */
export async function hitRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const hashed = sha256(key);
  const [, rows] = await db.$transaction([
    db.$executeRaw`
      INSERT INTO \`rate_limit_buckets\` (\`key\`, \`count\`, \`window_start\`)
      VALUES (${hashed}, 1, UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        \`count\` = IF(\`window_start\` < UTC_TIMESTAMP(3) - INTERVAL ${windowSeconds} SECOND, 1, \`count\` + 1),
        \`window_start\` = IF(\`window_start\` < UTC_TIMESTAMP(3) - INTERVAL ${windowSeconds} SECOND, UTC_TIMESTAMP(3), \`window_start\`)`,
    db.$queryRaw<{ count: number | bigint }[]>`SELECT \`count\` FROM \`rate_limit_buckets\` WHERE \`key\` = ${hashed}`,
  ]);
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
