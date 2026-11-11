// E2E server: fresh throwaway database (created → migrated → seeded) + `next dev` on :3100 with a
// separate build dir. On exit, drops only the database it created. Never touches dev/prod data.
import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { connectDatabase, connectServer, quoteDbName, testServerUrl, urlForDatabase } from "../support/mysql-admin.mjs";

// Same server and user as DATABASE_URL; only the throwaway joia_e2e_* database below is used.
const baseUrl = testServerUrl();
const name = `joia_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
const admin = await connectServer(baseUrl);
// Playwright may hard-kill this process, skipping cleanup: sweep databases left by earlier E2E runs.
// The joia_e2e_ prefix is only ever used by this script.
const stale = await admin.query(`SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'joia\\_e2e\\_%'`);
for (const row of stale) await admin.query(`DROP DATABASE IF EXISTS ${quoteDbName(row.name)}`);
await admin.query(`CREATE DATABASE ${quoteDbName(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await admin.end();
const url = urlForDatabase(baseUrl, name);
const env = { ...process.env, DATABASE_URL: url };
execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
execSync("npx prisma db seed", { env, stdio: "ignore" });

// Fixture: open the Friday window "now" so tickets can be checked in during the test run.
// Prisma stores DATETIME values in UTC, hence UTC_TIMESTAMP rather than NOW().
const c = await connectDatabase(url);
await c.query("UPDATE ticket_types SET valid_from = UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, valid_until = UTC_TIMESTAMP(3) + INTERVAL 1 DAY WHERE code = 'FRI'");
await c.query("UPDATE tickets t JOIN ticket_types tt ON t.ticket_type_id = tt.id SET t.valid_from = tt.valid_from, t.valid_until = tt.valid_until WHERE tt.code = 'FRI'");
await c.end();
mkdirSync(".data", { recursive: true });
writeFileSync(".data/e2e-db-url", url);

const next = spawn("npx", ["next", "dev", "--port", "3100"], {
  env: { ...env, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_APP_URL: "http://localhost:3100", MFA_ENCRYPTION_KEY: "e2e-mfa-key-e2e-mfa-key-e2e-mfa-key-0001" },
  stdio: "inherit",
});
const cleanup = async () => {
  next.kill("SIGTERM");
  const d = await connectServer(baseUrl);
  await d.query(`DROP DATABASE IF EXISTS ${quoteDbName(name)}`);
  await d.end();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
