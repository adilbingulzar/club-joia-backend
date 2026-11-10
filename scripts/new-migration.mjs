#!/usr/bin/env node
/**
 * Creates a new migration from the difference between the database and prisma/schema.prisma,
 * without touching the database (a safe replacement for `prisma migrate dev`, which is disabled
 * because it can reset the database — see prisma.config.ts).
 *
 *   npm run db:migration:new -- add_member_notes   → writes prisma/migrations/<timestamp>_add_member_notes/migration.sql
 *   npm run db:deploy                              → applies it
 *
 * Tables this project's migrations never created (e.g. tables another app keeps in the same
 * database) are left out: the migration never drops or alters them.
 * Review the generated SQL before deploying: Prisma writes DROP statements when the schema
 * removes one of this project's columns or tables.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIGRATIONS = join("prisma", "migrations");
const name = (process.argv[2] ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
if (!name) {
  console.error("Usage: npm run db:migration:new -- <name>   (e.g. add_member_notes)");
  process.exit(1);
}

const prisma = (args) => execFileSync("npx", ["prisma", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The database must already have every existing migration, or the diff would repeat them.
try {
  prisma(["migrate", "status"]);
} catch (e) {
  console.error("The database is not up to date with prisma/migrations. Run `npm run db:deploy` first.\n");
  console.error(String(e.stdout ?? e.message).trim());
  process.exit(1);
}

// Write the diff to a file: Prisma prints other messages on stdout.
const tmp = mkdtempSync(join(tmpdir(), "joia-migration-"));
const out = join(tmp, "diff.sql");
prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script", "-o", out]);
const diff = existsSync(out) ? readFileSync(out, "utf8") : "";
rmSync(tmp, { recursive: true, force: true });

// Tables created by this project's migrations; anything else in the database belongs to someone else.
const ours = new Set();
for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
  const file = join(MIGRATIONS, dir.name, "migration.sql");
  if (!dir.isDirectory() || !existsSync(file)) continue;
  for (const m of readFileSync(file, "utf8").matchAll(/CREATE TABLE `([^`]+)`/g)) ours.add(m[1]);
}
for (const m of readFileSync(join("prisma", "schema.prisma"), "utf8").matchAll(/@@map\("([^"]+)"\)/g)) ours.add(m[1]);

// Prisma separates statements with a blank line after each `;`.
const statements = diff.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.replace(/--.*$/gm, "").trim());
const skipped = new Set();
const kept = statements.filter((s) => {
  const tables = [...s.matchAll(/(?:TABLE|ON|REFERENCES)\s+`([^`]+)`/g)].map((m) => m[1]);
  const foreign = tables.filter((t) => !ours.has(t));
  foreign.forEach((t) => skipped.add(t));
  return foreign.length === 0;
});
if (skipped.size) console.log(`Left out tables this project does not manage: ${[...skipped].join(", ")}`);

if (kept.length === 0) {
  console.log("No schema changes: prisma/schema.prisma already matches the database.");
  process.exit(0);
}

const sql = kept.map((s) => `${s};`).join("\n\n") + "\n";
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const dir = join(MIGRATIONS, `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "migration.sql"), sql);
console.log(`Created ${dir}/migration.sql`);
if (/\bDROP\b/i.test(sql)) console.log("⚠  It contains DROP statements — check that no data you need is removed.");
console.log("Review it, then apply with: npm run db:deploy");
