import { PrismaMariaDb } from "@prisma/adapter-mariadb";

/**
 * Prisma driver adapter for MySQL 8 (also works with MariaDB), shared by the app, the seed and
 * test tooling. No `server-only` import so plain Node scripts can use it.
 *
 * Every connection is pinned to UTC (`timezone=Z` → `SET time_zone='+00:00'`). Prisma reads and
 * writes DATETIME values as UTC, while MySQL evaluates `CURRENT_TIMESTAMP` defaults and `NOW()` in
 * the session time zone, so without this a server running in e.g. Asia/Dubai would store raw-SQL
 * timestamps hours off.
 *
 * Accepts `mysql://` or `mariadb://` URLs; an explicit `timezone` in the URL is overridden.
 * (Next.js note: the mariadb pool reads the clock synchronously, see getSessionUser in
 * src/lib/auth/dal.ts.)
 */
export function mysqlConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("timezone", "Z");
  // MySQL 8 users authenticate with caching_sha2_password. Over a non-TLS connection the first
  // login after a MySQL restart (or FLUSH PRIVILEGES) needs the server's RSA key, which the
  // mariadb driver refuses to fetch unless allowed — the app would then fail with "pool timeout"
  // until some other client happened to log in. Fine for a database on the same host; for a
  // remote database prefer TLS (`?ssl=true`) and set allowPublicKeyRetrieval=false in the URL.
  if (!url.searchParams.has("allowPublicKeyRetrieval")) url.searchParams.set("allowPublicKeyRetrieval", "true");
  // Suits a single long-lived Node server; override in DATABASE_URL if needed.
  if (!url.searchParams.has("connectionLimit")) url.searchParams.set("connectionLimit", "10");
  return url.toString();
}

export function createMySqlAdapter(databaseUrl: string | undefined = process.env.DATABASE_URL): PrismaMariaDb {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  return new PrismaMariaDb(mysqlConnectionString(databaseUrl));
}
