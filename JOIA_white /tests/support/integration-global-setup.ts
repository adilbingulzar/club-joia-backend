import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-db-url";

/**
 * Each integration run gets its own fresh, uniquely named database on the TEST_DATABASE_URL
 * server: created → migrated → seeded → used → dropped. Nothing pre-existing is reset or wiped.
 */
export default async function setup() {
  const base = new URL(testDatabaseUrl());
  const name = `joia_it_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const runUrl = new URL(base.toString());
  runUrl.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: runUrl.toString() };
  execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
  execSync("npx prisma db seed", { env, stdio: "ignore" });
  process.env.TEST_RUN_DATABASE_URL = runUrl.toString();

  return async () => {
    const c = new Client({ connectionString: base.toString() });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); // only the database this run created
    await c.end();
  };
}
