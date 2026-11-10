#!/usr/bin/env node
/**
 * Creates (or resets) a SUPER_ADMIN account on the server's database and prints a one-time,
 * randomly generated password. Use it for the first admin on a fresh server; invite everyone
 * else from Admin → Staff.
 *
 * Usage: node tools/create-admin.mjs <email> "<Full name>"
 *
 * If the email already exists, the account is promoted to SUPER_ADMIN, activated, unlocked, its
 * password is replaced, and all of its sessions are signed out.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import pg from "pg";

const file = join(process.cwd(), ".env");
if (existsSync(file)) process.loadEnvFile(file);

const [emailArg, ...nameParts] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const name = nameParts.join(" ").trim() || "Administrator";
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node tools/create-admin.mjs <email> "<Full name>"');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set (check .env).");
  process.exit(1);
}

const password = randomBytes(15).toString("base64url"); // 20 characters
const passwordHash = await hash(password); // Argon2id, same parameters as the app

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rowCount) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE users SET role = 'SUPER_ADMIN', status = 'ACTIVE', password_hash = $2, password_changed_at = now(),
         failed_login_count = 0, locked_until = NULL, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
       WHERE id = $1`,
      [id, passwordHash],
    );
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    console.log(`Updated ${email}: now an active SUPER_ADMIN with a new password.`);
  } else {
    const id = "c" + randomBytes(16).toString("hex").slice(0, 24);
    await client.query(
      `INSERT INTO users (id, email, name, password_hash, role, status, email_verified_at, password_changed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', 'ACTIVE', now(), now(), now(), now())`,
      [id, email, name, passwordHash],
    );
    console.log(`Created SUPER_ADMIN ${email} (${name}).`);
  }
  console.log(`\n  Sign in at: ${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/admin/login`);
  console.log(`  Password:   ${password}\n\nThis password is shown only once. Store it in a password manager.`);
} finally {
  await client.end();
}
