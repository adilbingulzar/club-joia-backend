#!/usr/bin/env node
/**
 * Applies the database migrations in ./prisma/migrations (oldest first) to DATABASE_URL.
 *
 * Release-bundle replacement for `prisma migrate deploy`, so the server does not need the Prisma
 * CLI. It records each migration in Prisma's own `_prisma_migrations` table (same checksum), so
 * `prisma migrate deploy` / `prisma migrate status` keep working against this database later.
 * Safe to re-run: applied migrations are skipped; a migration whose file changed is refused.
 *
 * Usage: node tools/migrate.mjs        (reads .env in the current folder)
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set (check .env).");

const dir = join(process.cwd(), "prisma", "migrations");
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
  .map((d) => d.name)
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const { rows } = await client.query(
    `SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
  );
  const applied = new Map(rows.map((r) => [r.migration_name, r]));

  let count = 0;
  for (const name of migrations) {
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const done = applied.get(name);
    if (done) {
      if (!done.finished_at) fail(`Migration ${name} previously failed part-way. Fix the database by hand, then retry.`);
      if (done.checksum !== checksum) fail(`Migration ${name} was already applied but its file has changed. Refusing to continue.`);
      continue;
    }
    process.stdout.write(`Applying ${name} … `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), 1)`,
        [randomUUID(), checksum, name],
      );
      await client.query("COMMIT");
      console.log("done");
      count++;
    } catch (e) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      throw e;
    }
  }
  console.log(count ? `${count} migration(s) applied.` : "Database is up to date.");
} finally {
  await client.end();
}

function loadEnvFile() {
  const file = join(process.cwd(), ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
