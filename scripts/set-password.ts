/**
 * Sets a password you choose for an existing account (any role), e.g. the super admin.
 *
 *   npm run user:set-password -- <email>
 *
 * The password is typed at a hidden prompt (twice), never passed as an argument, so it stays out
 * of shell history and the process list. Two-factor sign-in is left as it is. The account is
 * unlocked and all of its sessions are signed out. Disabled or not-yet-activated accounts are
 * refused: enable or invite them from the admin first.
 * Reads DATABASE_URL from .env.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMySqlAdapter } from "../src/lib/db-adapter";
import { passwordSchema } from "../src/validators/auth";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run user:set-password -- <email>");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in an interactive terminal: the password is typed at a hidden prompt.");
  process.exit(1);
}

/** Reads one line without echoing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    output._writeToOutput = (s: string) => {
      if (!muted || s.includes("\n") || s.includes("\r")) output.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const db = new PrismaClient({ adapter: createMySqlAdapter(process.env.DATABASE_URL) });

async function main() {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with email ${email}.`);
  if (user.status !== "ACTIVE") throw new Error(`${email} is ${user.status}; only active accounts can be given a password here.`);

  const password = await askHidden(`New password for ${email} (${user.role}): `);
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid password.");
  if ((await askHidden("Type it again: ")) !== password) throw new Error("Passwords do not match. Nothing was changed.");

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.auditLog.create({ data: { action: "auth.cli_password_set", entityType: "user", entityId: user.id, afterData: { email } } });

  console.log(`Password updated for ${email}. All of its sessions were signed out; two-factor sign-in is unchanged.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
