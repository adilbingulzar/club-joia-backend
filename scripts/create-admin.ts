/**
 * Creates (or resets) a SUPER_ADMIN account and prints a one-time, randomly generated password.
 * Use it for the first admin on a fresh server; invite everyone else from Admin → Staff.
 *
 *   npm run admin:create -- <email> "<Full name>"
 *
 * If the email already exists, the account is promoted to SUPER_ADMIN, activated, unlocked, its
 * password is replaced and all of its sessions are signed out. Reads DATABASE_URL from .env.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMySqlAdapter } from "../src/lib/db-adapter";

const [emailArg, ...nameParts] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const name = nameParts.join(" ").trim() || "Administrator";
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
  console.error('Usage: npm run admin:create -- <email> "<Full name>"');
  process.exit(1);
}

const db = new PrismaClient({ adapter: createMySqlAdapter(process.env.DATABASE_URL) });

async function main() {
  const password = randomBytes(15).toString("base64url"); // 20 characters
  const passwordHash = await hash(password); // Argon2id, same parameters as the app
  const now = new Date();
  const access = { role: "SUPER_ADMIN", status: "ACTIVE", passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } as const;

  const existing = await db.user.findUnique({ where: { email } });
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { ...access, emailVerifiedAt: existing.emailVerifiedAt ?? now } })
    : await db.user.create({ data: { ...access, email, name, emailVerifiedAt: now } });
  if (existing) await db.session.deleteMany({ where: { userId: user.id } });
  await db.auditLog.create({
    data: { action: existing ? "staff.cli_reset_super_admin" : "staff.cli_create_super_admin", entityType: "user", entityId: user.id, afterData: { email, role: "SUPER_ADMIN" } },
  });

  console.log(existing ? `Updated ${email}: now an active SUPER_ADMIN with a new password.` : `Created SUPER_ADMIN ${email} (${name}).`);
  console.log(`\n  Sign in at: ${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/admin/login`);
  console.log(`  Password:   ${password}\n\nThis password is shown only once. Store it in a password manager.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
