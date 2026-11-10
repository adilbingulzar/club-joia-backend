import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Guard: Prisma CLI commands that can wipe or drop data are refused for this project.
 * Every Prisma CLI command loads this file first, so the check holds for `npx prisma …`,
 * npm scripts and any database user. Application code (Prisma Client) is not affected.
 *
 *   blocked  migrate reset   drops the whole database
 *            migrate dev     offers to reset the database when it detects drift
 *            db push         can drop columns/tables to match the schema (--accept-data-loss, --force-reset)
 *            db execute      runs arbitrary SQL
 *
 *   allowed  migrate deploy / status / diff / resolve, db seed, db pull, generate, studio, validate, format
 *
 * Create new migrations with `npm run db:migration:new -- <name>` (writes the SQL file only,
 * never resets) and apply them with `npm run db:deploy`.
 */
const BLOCKED: Record<string, string> = {
  "migrate reset": "it drops every table and all data",
  "migrate dev": "it can reset the database when it detects drift — use `npm run db:migration:new -- <name>` then `npm run db:deploy`",
  "db push": "it can drop columns or tables to match the schema — use migrations instead",
  "db execute": "it runs arbitrary SQL against the database",
};

/** "<command> <subcommand>" from the CLI arguments, skipping flags and their values. */
function cliCommand(argv: string[]): string {
  const words: string[] = [];
  for (let i = 0; i < argv.length && words.length < 2; i++) {
    const arg = argv[i];
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && ["--schema", "--config"].includes(arg)) i++; // skip the flag's value
      continue;
    }
    words.push(arg);
  }
  return words.join(" ");
}

const command = cliCommand(process.argv.slice(2));
if (BLOCKED[command]) {
  console.error(`\n✋ \`prisma ${command}\` is disabled for this project: ${BLOCKED[command]}.\n   See prisma.config.ts.\n`);
  process.exit(1);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not env("DATABASE_URL"): that throws when the variable is missing, which breaks
    // `npm install` (postinstall runs `prisma generate`) on a fresh checkout without a .env.
    // Commands that really connect (migrate, seed, studio) still fail clearly without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
