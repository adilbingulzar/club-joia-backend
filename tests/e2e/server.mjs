// E2E server: fresh throwaway database (created → migrated → seeded) + `next dev` on :3100 with a
// separate build dir. On exit, drops only the database it created. Never touches dev/prod data.
import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const baseUrl = process.env.TEST_DATABASE_URL;
if (!baseUrl) throw new Error("TEST_DATABASE_URL is not set");
const name = `joia_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
const admin = new pg.Client({ connectionString: baseUrl });
await admin.connect();
// Playwright may hard-kill this process, skipping cleanup: sweep databases left by earlier E2E runs.
// The joia_e2e_ prefix is only ever used by this script.
const stale = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'joia\\_e2e\\_%'`);
for (const { datname } of stale.rows) await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();
const url = new URL(baseUrl);
url.pathname = `/${name}`;
const env = { ...process.env, DATABASE_URL: url.toString() };
execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
execSync("npx prisma db seed", { env, stdio: "ignore" });

// Fixture: open the Friday window "now" so tickets can be checked in during the test run.
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
await c.query(`UPDATE ticket_types SET valid_from = now() - interval '1 hour', valid_until = now() + interval '1 day' WHERE code = 'FRI'`);
await c.query(`UPDATE tickets t SET valid_from = tt.valid_from, valid_until = tt.valid_until FROM ticket_types tt WHERE t.ticket_type_id = tt.id AND tt.code = 'FRI'`);
await c.end();
mkdirSync(".data", { recursive: true });
writeFileSync(".data/e2e-db-url", url.toString());

const next = spawn("npx", ["next", "dev", "--port", "3100"], {
  env: { ...env, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_APP_URL: "http://localhost:3100" },
  stdio: "inherit",
});
const cleanup = async () => {
  next.kill("SIGTERM");
  const d = new pg.Client({ connectionString: baseUrl });
  await d.connect();
  await d.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await d.end();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
