// Local development PostgreSQL — real PostgreSQL binaries from the `embedded-postgres`
// package, stored in ./.data/postgres. No Docker or system install required.
//
//   npm run db:start          → runs in the foreground until Ctrl+C
//
// Production uses any managed PostgreSQL (DATABASE_URL). This script is never used there.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const databaseDir = path.resolve(".data/postgres");
const databases = ["joia_dev", "joia_test"];

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "joia",
  password: "joia-local-dev-only",
  port,
  persistent: true,
  onLog: () => {},
});

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
  console.log("Initialising local PostgreSQL cluster in .data/postgres …");
  await pg.initialise();
}
await pg.start();
for (const name of databases) {
  try {
    await pg.createDatabase(name);
    console.log(`Created database ${name}`);
  } catch {
    /* already exists */
  }
}
console.log(`PostgreSQL ready on postgres://joia:***@localhost:${port} (databases: ${databases.join(", ")})`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
