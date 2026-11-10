// Helpers for test tooling that needs a raw MySQL connection (creating / dropping throwaway
// databases, fixtures). Plain ESM so both Vitest setup (TS) and tests/e2e/server.mjs can use it.
import mariadb from "mariadb";

/**
 * The MySQL server and credentials tests use: those of DATABASE_URL. Tests never touch the
 * database named there. They only create, use and drop their own `joia_it_*` / `joia_e2e_*`
 * databases, so the user needs CREATE and DROP on those names. Don't run tests on a live server.
 */
export function testServerUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
  return url;
}

/** Connects to the server in `databaseUrl` without selecting a database (it may not exist yet). */
export function connectServer(databaseUrl) {
  const u = new URL(databaseUrl);
  return mariadb.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    timezone: "Z",
    allowPublicKeyRetrieval: true, // see src/lib/db-adapter.ts
  });
}

/** Connects to one database on that server. */
export function connectDatabase(databaseUrl) {
  const u = new URL(databaseUrl);
  return mariadb.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    timezone: "Z",
    allowPublicKeyRetrieval: true, // see src/lib/db-adapter.ts
  });
}

/** Same server and credentials, different database name. */
export function urlForDatabase(databaseUrl, name) {
  const u = new URL(databaseUrl);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Backtick-quotes a database name we generated ourselves; refuses anything unexpected. */
export function quoteDbName(name) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error(`Refusing unexpected database name: ${name}`);
  return `\`${name}\``;
}
