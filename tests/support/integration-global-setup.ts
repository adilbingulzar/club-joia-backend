import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import "dotenv/config";
import { connectServer, quoteDbName, testServerUrl, urlForDatabase } from "./mysql-admin.mjs";

/**
 * Each integration run gets its own fresh, uniquely named database on the DATABASE_URL server:
 * created → migrated → seeded → used → dropped. The database named in DATABASE_URL, and anything
 * else pre-existing, is never touched. The user needs CREATE and DROP on `joia_it_*` names.
 */
export default async function setup() {
  const base = testServerUrl();
  const name = `joia_it_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const admin = await connectServer(base);
  await admin.query(`CREATE DATABASE ${quoteDbName(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const runUrl = urlForDatabase(base, name);
  const env = { ...process.env, DATABASE_URL: runUrl };
  execSync("npx prisma migrate deploy", { env, stdio: "ignore" });
  execSync("npx prisma db seed", { env, stdio: "ignore" });
  process.env.TEST_RUN_DATABASE_URL = runUrl;

  return async () => {
    const c = await connectServer(base);
    await c.query(`DROP DATABASE IF EXISTS ${quoteDbName(name)}`); // only the database this run created
    await c.end();
  };
}
