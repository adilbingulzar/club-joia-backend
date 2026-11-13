import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { GET as cronGet } from "@/app/api/cron/notifications/route";
import { totpCode, totpStep, TOTP_STEP_SECONDS } from "@/lib/security/totp";
import { requestMeta } from "@/lib/auth/session";
import { clientIp } from "@/lib/security/ip-allowlist";
import type { Role } from "@/generated/prisma/enums";
import { activateAccount, authenticate, hashPassword, requestPasswordReset, validateSessionToken } from "@/services/auth.service";
import { startMfaEnrolment, verifyMfaCode } from "@/services/mfa.service";
import { issueQrForMyTicket, scan } from "@/services/qr.service";
import { addMessage, createRequest } from "@/services/concierge.service";
import { createMember, exportMyData, removeMyPhoto, setMyPhoto } from "@/services/member.service";
import type { Actor } from "@/services/context";
import { actorFor, EMAILS, ticketOf, zoneId } from "../support/actors";

/**
 * Every limit in RATE_LIMITS (and the MFA code limit) exercised through the real services:
 * the boundary (limit allowed, limit+1 refused and nothing done), key isolation, the window
 * (rate_limit_buckets.window_start is aged instead of sleeping) and parallel calls.
 *
 * Tests use their own users / IPs (10.250.x.x) wherever possible. Buckets touched on seeded
 * users are deleted afterwards so other test files see untouched limits.
 */

// requestMeta() and the cron route read next/headers; outside a request we hand them our own.
const headerStore = vi.hoisted(() => {
  process.env.CRON_SECRET = "test-cron-secret-rate-limits";
  return { current: new Headers() };
});
vi.mock("next/headers", () => ({
  headers: async () => headerStore.current,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const LIMITER_MSG = "Too many attempts. Please wait a few minutes and try again.";
const GENERIC_MSG = "Email or password is incorrect. If you were recently invited, please use the activation link in your invitation first.";
const PW = "RateLimit-Test-Pw-2026";

const run = randomBytes(3).toString("hex");
let seq = 0;
const uid = () => `${run}-${++seq}`;
let ipSeq = 0;
/** A fresh IP per call site, unique within this run. */
const freshIp = () => `10.250.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

let pwHash: string;
let infoSpy: MockInstance<typeof console.info>;
let warnSpy: MockInstance<typeof console.warn>;
const seededKeys = new Set<string>();

beforeAll(async () => {
  pwHash = await hashPassword(PW);
  // The console email driver and staff alerts log a lot; keep the output readable (and countable).
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  if (seededKeys.size) await db.rateLimitBucket.deleteMany({ where: { key: { in: [...seededKeys].map(sha256) } } });
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function makeUser(role: Role = "MEMBER") {
  return db.user.create({ data: { email: `rl-${uid()}@joia.test`, name: "Rate Limit Test", role, status: "ACTIVE", passwordHash: pwHash } });
}

function staffActor(user: { id: string; role: Role }): Actor {
  return { userId: user.id, role: user.role, memberId: null, ipAddress: "127.0.0.1", userAgent: "vitest" };
}

async function makeMember(opts: { invite?: boolean } = {}) {
  const admin = await actorFor(EMAILS.admin);
  const tier = await db.membershipTier.findFirstOrThrow({ where: { slug: "ruby-red" } });
  const email = `rlm-${uid()}@joia.test`;
  const { memberId, activation } = await createMember(admin, { firstName: "Rate", lastName: `Limit${seq}`, email, tierId: tier.id, sendInvitation: !!opts.invite });
  const member = await db.member.findUniqueOrThrow({ where: { id: memberId } });
  const actor: Actor = { userId: member.userId, role: "MEMBER", memberId, ipAddress: "127.0.0.1", userAgent: "vitest" };
  return { actor, email, activation };
}

const bucket = (key: string) => db.rateLimitBucket.findUnique({ where: { key: sha256(key) } });

/** Moves the bucket's window start `secondsAgo` into the past (instead of waiting). */
async function ageBucket(key: string, secondsAgo: number) {
  await db.rateLimitBucket.update({ where: { key: sha256(key) }, data: { windowStart: new Date(Date.now() - secondsAgo * 1000) } });
}

/** Sets a bucket to `count` hits in a window that started now (to reach very high limits fast). */
async function presetBucket(key: string, count: number) {
  await db.rateLimitBucket.upsert({
    where: { key: sha256(key) },
    create: { key: sha256(key), count, windowStart: new Date() },
    update: { count, windowStart: new Date() },
  });
}

async function settle<T>(promises: Promise<T>[]) {
  const results = await Promise.allSettled(promises);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as AppError);
  return { ok, errors, codes: errors.map((e) => e.code) };
}

const expectLimited = (p: Promise<unknown>, message: string = LIMITER_MSG) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "RATE_LIMITED" && e.status === 429 && e.message === message);

const sessions = (userId: string) => db.session.count({ where: { userId } });
const audits = (action: string, entityId: string) => db.auditLog.count({ where: { action, entityId } });
const emailsLoggedTo = (to: string) => infoSpy.mock.calls.filter((c) => String(c[0]).includes("[email:console]") && String(c[0]).includes(`To: ${to}\n`)).length;

const TINY_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const png = () => new File([TINY_PNG], "photo.png", { type: "image/png" });

// ─── login ──────────────────────────────────────────────────────────────────

describe("login per email (8 / 15 min)", () => {
  const { limit, window } = RATE_LIMITS.loginPerEmail;

  it("allows 8 calls, refuses the 9th even with the correct password; a success does not reset the counter", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < limit; i++) await authenticate(user.email, PW, ip); // 8 successful sign-ins
    expect(await sessions(user.id)).toBe(limit);
    expect((await bucket(`login:email:${user.email}`))?.count).toBe(limit);

    await expectLimited(authenticate(user.email, PW, ip));
    expect(await sessions(user.id)).toBe(limit); // no session for the refused call

    // another email from the same IP is not affected
    const other = await makeUser();
    await expect(authenticate(other.email, PW, ip)).resolves.toMatchObject({ userId: other.id });

    // still inside the window: refused; once it has passed: allowed again with a fresh count
    await ageBucket(`login:email:${user.email}`, window - 60);
    await expectLimited(authenticate(user.email, PW, ip));
    await ageBucket(`login:email:${user.email}`, window + 5);
    await expect(authenticate(user.email, PW, ip)).resolves.toMatchObject({ userId: user.id });
    expect((await bucket(`login:email:${user.email}`))?.count).toBe(1);
  });

  it("after 8 wrong passwords the correct one is refused until the window passes; there is no account lock", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < limit; i++) {
      await expect(authenticate(user.email, "wrong-password-xx", ip)).rejects.toMatchObject({ code: "UNAUTHENTICATED", message: GENERIC_MSG });
    }
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ lockedUntil: null, failedLoginCount: 0 }); // no lock is recorded any more

    await expectLimited(authenticate(user.email, PW, ip));
    expect(await sessions(user.id)).toBe(0);

    await ageBucket(`login:email:${user.email}`, window + 5);
    await expect(authenticate(user.email, PW, ip)).resolves.toMatchObject({ userId: user.id });
  });
  it("a locked-looking account and an unknown email get exactly the wrong-password answer", async () => {
    const user = await makeUser();
    // values a former lockout may have left behind are ignored
    await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 8, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
    const unknown = `nobody-${uid()}@joia.test`;
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < limit; i++) {
      await expect(authenticate(user.email, "wrong-password-xx", ip)).rejects.toMatchObject({ code: "UNAUTHENTICATED", message: GENERIC_MSG });
      await expect(authenticate(unknown, "wrong-password-xx", ip)).rejects.toMatchObject({ code: "UNAUTHENTICATED", message: GENERIC_MSG });
    }
    // both buckets full: the same limiter answer for both
    await expectLimited(authenticate(user.email, "wrong-password-xx", ip));
    await expectLimited(authenticate(unknown, "wrong-password-xx", ip));
    // window over: wrong password → the generic answer for both, never a "locked" one
    await ageBucket(`login:email:${user.email}`, window + 5);
    await ageBucket(`login:email:${unknown}`, window + 5);
    await expect(authenticate(user.email, "wrong-password-xx", ip)).rejects.toMatchObject({ code: "UNAUTHENTICATED", message: GENERIC_MSG });
    await expect(authenticate(unknown, "wrong-password-xx", ip)).rejects.toMatchObject({ code: "UNAUTHENTICATED", message: GENERIC_MSG });
    // and the right password works; the stale lock columns are cleared
    await expect(authenticate(user.email, PW, ip)).resolves.toMatchObject({ userId: user.id });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("timing: a known account with a wrong password and an unknown email both run one Argon2 check", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    const time = async (email: string) => {
      const t = performance.now();
      await authenticate(email, "wrong-password-xx", ip).catch(() => {});
      return performance.now() - t;
    };
    await time(`warmup-${uid()}@joia.test`); // builds the dummy hash once
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 4; i++) {
      known.push(await time(user.email));
      unknown.push(await time(`nobody-${uid()}@joia.test`));
    }
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    // loose bound: no fast path (e.g. a lock check before the hash) that would be ~10× quicker
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.4);
    expect(median(known)).toBeGreaterThan(median(unknown) * 0.4);
  });
  it("parallel: 20 simultaneous correct sign-ins → exactly 8 succeed", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    const r = await settle(Array.from({ length: 20 }, () => authenticate(user.email, PW, ip)));
    expect(r.ok).toBe(limit);
    expect(r.codes).toEqual(Array(20 - limit).fill("RATE_LIMITED"));
    expect(await sessions(user.id)).toBe(limit);
  });

  it("the service normalises the email: case / space variants share one bucket", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    const variants = [user.email, user.email.toUpperCase(), ` ${user.email} `, `\t${user.email.toUpperCase()}`];
    for (let i = 0; i < limit; i++) await authenticate(variants[i % variants.length], PW, ip);
    for (const v of variants) await expectLimited(authenticate(v, PW, ip));
    expect((await bucket(`login:email:${user.email}`))?.count).toBe(limit + variants.length);
    expect(await sessions(user.id)).toBe(limit);
  });
});

describe("login per IP (40 / 15 min)", () => {
  const { limit, window } = RATE_LIMITS.loginPerIp;

  it("allows 40 calls across many emails, then refuses any email (also a correct password); other IPs unaffected", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < limit; i++) {
      await expect(authenticate(`nobody-${uid()}@joia.test`, "wrong-password-xx", ip)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
    await expectLimited(authenticate(user.email, PW, ip));
    expect(await sessions(user.id)).toBe(0);
    // the IP check runs first: the refused call did not count against the email
    expect(await bucket(`login:email:${user.email}`)).toBeNull();

    await expect(authenticate(user.email, PW, { ipAddress: freshIp() })).resolves.toMatchObject({ userId: user.id });

    await ageBucket(`login:ip:${ip.ipAddress}`, window - 60);
    await expectLimited(authenticate(user.email, PW, ip));
    await ageBucket(`login:ip:${ip.ipAddress}`, window + 5);
    await expect(authenticate(user.email, PW, ip)).resolves.toMatchObject({ userId: user.id });
  });

  it("parallel: 50 simultaneous attempts from one IP → exactly 40 get past the limiter", async () => {
    const ip = { ipAddress: freshIp() };
    const r = await settle(Array.from({ length: 50 }, () => authenticate(`nobody-${uid()}@joia.test`, "wrong-password-xx", ip)));
    expect(r.codes.filter((c) => c === "UNAUTHENTICATED")).toHaveLength(limit);
    expect(r.codes.filter((c) => c === "RATE_LIMITED")).toHaveLength(50 - limit);
  });

  it("requests without an IP skip only the per-IP limit (no shared 'unknown' bucket) and are logged", async () => {
    warnSpy.mockClear();
    for (let i = 0; i < limit + 5; i++) {
      await expect(authenticate(`nobody-${uid()}@joia.test`, "wrong-password-xx", i % 2 ? {} : { ipAddress: null })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
    expect(await bucket("login:ip:unknown")).toBeNull();
    expect(await bucket("login:ip:null")).toBeNull();
    expect(warnSpy.mock.calls.filter((c) => String(c[0]).includes("[rate-limit] login"))).toHaveLength(limit + 5); // once per request

    // the per-email limit still applies
    const user = await makeUser();
    for (let i = 0; i < RATE_LIMITS.loginPerEmail.limit; i++) await authenticate(user.email, PW, {});
    await expectLimited(authenticate(user.email, PW, {}));

    // reset and activation behave the same
    for (let i = 0; i < RATE_LIMITS.passwordResetPerIp.limit + 2; i++) await requestPasswordReset(`nobody-${uid()}@joia.test`, {});
    expect(await bucket("reset:ip:unknown")).toBeNull();
    for (let i = 0; i < RATE_LIMITS.activationPerIp.limit + 2; i++) {
      await expect(activateAccount(randomBytes(32).toString("base64url"), "Activation-Pw-2026", {})).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
    expect(await bucket("activate:ip:unknown")).toBeNull();
  });
  it("requestMeta() uses the LAST X-Forwarded-For entry: fake first entries are limited by the real address", async () => {
    // Proxy that overwrites the header ($remote_addr): the real IP is used.
    headerStore.current = new Headers({ "x-forwarded-for": "203.0.113.8" });
    expect((await requestMeta()).ipAddress).toBe("203.0.113.8");

    // Proxy that appends ($proxy_add_x_forwarded_for): the client-chosen first entry is ignored.
    const realIp = `203.0.${run.length}.${ipSeq % 250}`;
    const codes: string[] = [];
    for (let i = 1; i <= limit + 5; i++) {
      headerStore.current = new Headers({ "x-forwarded-for": `198.51.100.${i}, ${realIp}` });
      const meta = await requestMeta();
      expect(meta.ipAddress).toBe(clientIp(headerStore.current));
      expect(meta.ipAddress).toBe(realIp);
      await authenticate(`nobody-${uid()}@joia.test`, "wrong-password-xx", meta).catch((e) => codes.push((e as AppError).code));
    }
    expect(codes.filter((c) => c === "UNAUTHENTICATED")).toHaveLength(limit);
    expect(codes.filter((c) => c === "RATE_LIMITED")).toHaveLength(5);
    headerStore.current = new Headers();
  });
});

// ─── activation ─────────────────────────────────────────────────────────────

describe("activation per IP (20 / h)", () => {
  const { limit, window } = RATE_LIMITS.activationPerIp;
  const junk = () => randomBytes(32).toString("base64url");

  it("allows 20 calls, refuses the 21st (valid token untouched); other IP works; window resets", async () => {
    const { actor, activation } = await makeMember({ invite: true });
    const token = new URL(activation!.link).searchParams.get("token")!;
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < limit; i++) {
      await expect(activateAccount(junk(), "Activation-Pw-2026", ip)).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
    await expectLimited(activateAccount(token, "Activation-Pw-2026", ip));
    // nothing happened: token unused, account still pending, no session
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
    expect(user.status).toBe("PENDING_ACTIVATION");
    expect(await db.authToken.count({ where: { userId: actor.userId, type: "ACTIVATION", usedAt: null } })).toBe(1);
    expect(await sessions(actor.userId)).toBe(0);

    // window: refused shortly before the end, allowed after
    await ageBucket(`activate:ip:${ip.ipAddress}`, window - 60);
    await expectLimited(activateAccount(junk(), "Activation-Pw-2026", ip));
    await ageBucket(`activate:ip:${ip.ipAddress}`, window + 5);
    await expect(activateAccount(junk(), "Activation-Pw-2026", ip)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // a different IP is not affected: the real token still works
    const s = await activateAccount(token, "Activation-Pw-2026", { ipAddress: freshIp() });
    expect(await validateSessionToken(s.token)).toMatchObject({ userId: actor.userId });
  });

  it("parallel: 25 simultaneous attempts → exactly 20 reach the token check", async () => {
    const ip = { ipAddress: freshIp() };
    const r = await settle(Array.from({ length: 25 }, () => activateAccount(junk(), "Activation-Pw-2026", ip)));
    expect(r.codes.filter((c) => c === "INVALID_STATE")).toHaveLength(limit);
    expect(r.codes.filter((c) => c === "RATE_LIMITED")).toHaveLength(25 - limit);
  });
});

// ─── password reset ─────────────────────────────────────────────────────────

describe("password reset per email (3 / h) and per IP (20 / h)", () => {
  const perEmail = RATE_LIMITS.passwordResetPerEmail;
  const perIp = RATE_LIMITS.passwordResetPerIp;
  const resetTokens = (userId: string) => db.authToken.count({ where: { userId, type: "PASSWORD_RESET" } });

  it("per email: 3 requests issue a link, the 4th silently does nothing; other email unaffected; window resets", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < perEmail.limit; i++) await expect(requestPasswordReset(user.email, ip)).resolves.toBeUndefined();
    expect(await resetTokens(user.id)).toBe(3);
    expect(await audits("auth.password_reset_requested", user.id)).toBe(3);
    expect(emailsLoggedTo(user.email)).toBe(3);

    await expect(requestPasswordReset(user.email, ip)).resolves.toBeUndefined(); // no error shown
    expect(await resetTokens(user.id)).toBe(3); // no token
    expect(await audits("auth.password_reset_requested", user.id)).toBe(3);
    expect(emailsLoggedTo(user.email)).toBe(3); // no email

    const other = await makeUser();
    await requestPasswordReset(other.email, ip);
    expect(await resetTokens(other.id)).toBe(1);

    await ageBucket(`reset:email:${user.email}`, perEmail.window - 60);
    await requestPasswordReset(user.email, ip);
    expect(await resetTokens(user.id)).toBe(3);
    await ageBucket(`reset:email:${user.email}`, perEmail.window + 5);
    await requestPasswordReset(user.email, ip);
    expect(await resetTokens(user.id)).toBe(4);
  });

  it("per email: a hit limit looks exactly like an unknown email (no enumeration)", async () => {
    const user = await makeUser();
    const unknown = `nobody-${uid()}@joia.test`;
    const ip = { ipAddress: freshIp() };
    for (let i = 0; i < perEmail.limit; i++) await requestPasswordReset(user.email, ip);
    const limitedResult = await requestPasswordReset(user.email, ip);
    const unknownResult = await requestPasswordReset(unknown, ip);
    expect(limitedResult).toBeUndefined();
    expect(unknownResult).toBeUndefined();
    // and requestResetAction always answers with the same success text in both cases
  });

  it("per IP: 20 requests, the 21st throws RATE_LIMITED for known and unknown emails alike", async () => {
    const user = await makeUser();
    const ipA = { ipAddress: freshIp() };
    const ipB = { ipAddress: freshIp() };
    for (let i = 0; i < perIp.limit; i++) {
      await requestPasswordReset(`nobody-${uid()}@joia.test`, ipA);
      await requestPasswordReset(`nobody-${uid()}@joia.test`, ipB);
    }
    // same error whether the email exists or not → reveals the limit, not the account
    await expectLimited(requestPasswordReset(user.email, ipA));
    await expectLimited(requestPasswordReset(`nobody-${uid()}@joia.test`, ipB));
    expect(await resetTokens(user.id)).toBe(0);
    expect(emailsLoggedTo(user.email)).toBe(0);
    expect(await bucket(`reset:email:${user.email}`)).toBeNull(); // IP is checked first

    await requestPasswordReset(user.email, { ipAddress: freshIp() }); // other IP
    expect(await resetTokens(user.id)).toBe(1);

    await ageBucket(`reset:ip:${ipA.ipAddress}`, perIp.window + 5);
    await requestPasswordReset(user.email, ipA);
    expect(await resetTokens(user.id)).toBe(2);
  });

  it("parallel: 10 simultaneous requests for one email → exactly 3 links", async () => {
    const user = await makeUser();
    const ip = { ipAddress: freshIp() };
    const r = await settle(Array.from({ length: 10 }, () => requestPasswordReset(user.email, ip)));
    expect(r.ok).toBe(10);
    expect(await resetTokens(user.id)).toBe(perEmail.limit);
    expect(await db.authToken.count({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null } })).toBe(1); // only the newest is valid
  });
});

// ─── MFA ────────────────────────────────────────────────────────────────────

describe("MFA code attempts (5 / 15 min per user)", () => {
  const meta = { ipAddress: "10.250.200.1", userAgent: "vitest" };

  async function pending(email: string) {
    const r = await authenticate(email, PW, { ipAddress: freshIp() });
    const user = (await validateSessionToken(r.token, { allowMfaPending: true }))!;
    return { token: r.token, user };
  }
  const nowCode = (secret: string) => totpCode(secret, totpStep());
  function wrongCode(secret: string) {
    const s = totpStep();
    const valid = new Set([s - 1, s, s + 1, s + 2].map((x) => totpCode(secret, x)));
    for (let n = 123456; ; n++) if (!valid.has(String(n))) return String(n);
  }

  it("5 wrong codes, then the 6th (even a correct one) ends the session; the lock is per user; window resets", async () => {
    const admin = await makeUser("ADMIN");
    const s1 = await pending(admin.email);
    const { secret } = await startMfaEnrolment(s1.user);
    for (let i = 0; i < 5; i++) {
      await expect(verifyMfaCode(s1.user, wrongCode(secret), meta)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await audits("auth.mfa_failed", admin.id)).toBe(5);
    expect(await validateSessionToken(s1.token, { allowMfaPending: true })).not.toBeNull(); // still alive after 5

    await expectLimited(verifyMfaCode(s1.user, nowCode(secret), meta)); // 6th, correct code
    expect(await validateSessionToken(s1.token, { allowMfaPending: true })).toBeNull(); // session ended
    expect(await audits("auth.mfa_locked", admin.id)).toBe(1);
    const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row).toMatchObject({ mfaEnabled: false, mfaLastUsedStep: null }); // code not consumed

    // the password is needed again — and a new session is refused too until the window passes
    const s2 = await pending(admin.email);
    await expectLimited(verifyMfaCode(s2.user, nowCode(secret), meta));
    expect(await validateSessionToken(s2.token, { allowMfaPending: true })).toBeNull();
    expect(await audits("auth.mfa_locked", admin.id)).toBe(2);

    // another admin is not affected
    const other = await makeUser("ADMIN");
    const o = await pending(other.email);
    const otherSecret = (await startMfaEnrolment(o.user)).secret;
    await verifyMfaCode(o.user, nowCode(otherSecret), meta);
    expect(await validateSessionToken(o.token)).toMatchObject({ userId: other.id, mfaPending: false });

    // window: still locked shortly before the end, fine after
    await ageBucket(`mfa:user:${admin.id}`, 15 * 60 - 60);
    const s3 = await pending(admin.email);
    await expectLimited(verifyMfaCode(s3.user, nowCode(secret), meta));
    await ageBucket(`mfa:user:${admin.id}`, 15 * 60 + 5);
    const s4 = await pending(admin.email);
    await verifyMfaCode(s4.user, nowCode(secret), meta);
    expect(await validateSessionToken(s4.token)).toMatchObject({ userId: admin.id, mfaPending: false, mfaEnabled: true });
  });

  it("correct codes don't count: only 5 FAILED codes lock", async () => {
    // Needs three consecutive 30 s steps (s-1, s, s+1): don't start right before a step change.
    const left = TOTP_STEP_SECONDS * 1000 - (Date.now() % (TOTP_STEP_SECONDS * 1000));
    if (left < 8000) await new Promise((r) => setTimeout(r, left + 200));
    const s = totpStep();

    const admin = await makeUser("ADMIN");
    const a = await pending(admin.email);
    const { secret } = await startMfaEnrolment(a.user);
    await verifyMfaCode(a.user, totpCode(secret, s - 1), meta); // correct
    const b = await pending(admin.email);
    for (let i = 0; i < 4; i++) await expect(verifyMfaCode(b.user, wrongCode(secret), meta)).rejects.toMatchObject({ code: "VALIDATION" }); // 4 failures
    await verifyMfaCode(b.user, totpCode(secret, s), meta); // correct (6th attempt overall)
    const c = await pending(admin.email);
    await verifyMfaCode(c.user, totpCode(secret, s + 1), meta); // correct (7th attempt overall)
    for (const x of [a, b, c]) expect(await validateSessionToken(x.token)).toMatchObject({ userId: admin.id, mfaPending: false });
    expect((await bucket(`mfa:user:${admin.id}`))?.count).toBe(4);

    // a used code is a failure too: the 5th failure is still checked, the next attempt locks
    const d = await pending(admin.email);
    await expect(verifyMfaCode(d.user, totpCode(secret, s + 1), meta)).rejects.toMatchObject({ code: "VALIDATION" }); // replay = 5th failure
    await expectLimited(verifyMfaCode(d.user, wrongCode(secret), meta));
    expect(await validateSessionToken(d.token, { allowMfaPending: true })).toBeNull();
    expect(await audits("auth.mfa_locked", admin.id)).toBe(1);
  });

  it("parallel: 12 simultaneous wrong codes → exactly 5 are checked, the rest end the session", async () => {
    const admin = await makeUser("ADMIN");
    const p = await pending(admin.email);
    const { secret } = await startMfaEnrolment(p.user);
    const r = await settle(Array.from({ length: 12 }, () => verifyMfaCode(p.user, wrongCode(secret), meta)));
    expect(r.codes.filter((c) => c === "VALIDATION")).toHaveLength(5);
    expect(r.codes.filter((c) => c === "RATE_LIMITED")).toHaveLength(7);
    expect(await audits("auth.mfa_failed", admin.id)).toBe(5);
    expect(await validateSessionToken(p.token, { allowMfaPending: true })).toBeNull();
  });

  it("parallel: a correct code among simultaneous wrong ones still only lets 5 attempts be checked", async () => {
    const admin = await makeUser("ADMIN");
    const p = await pending(admin.email);
    const { secret } = await startMfaEnrolment(p.user);
    const attempts = [...Array.from({ length: 9 }, () => wrongCode(secret)), nowCode(secret)];
    const r = await settle(attempts.map((code) => verifyMfaCode(p.user, code, meta)));
    // never more than 5 wrong codes checked; the correct one may or may not have got through
    expect(r.codes.filter((c) => c === "VALIDATION").length).toBeLessThanOrEqual(5);
    expect(await audits("auth.mfa_failed", admin.id)).toBeLessThanOrEqual(5);
    expect(r.ok + r.codes.length).toBe(10);
  });
});

// ─── QR issue and scanning ──────────────────────────────────────────────────

describe("QR issue per user (120 / h)", () => {
  const { limit, window } = RATE_LIMITS.qrIssuePerUser;

  it("issues 120 QR codes, refuses the 121st; other member unaffected; window resets", { timeout: 120_000 }, async () => {
    const [alex, sophia] = await Promise.all([actorFor(EMAILS.alex), actorFor(EMAILS.sophia)]);
    const key = `qr:${alex.userId}`;
    seededKeys.add(key);
    seededKeys.add(`qr:${sophia.userId}`);
    await db.rateLimitBucket.deleteMany({ where: { key: sha256(key) } }); // other files may have issued some
    const ticket = await ticketOf(EMAILS.alex, "FRI");
    for (let i = 0; i < limit; i++) await issueQrForMyTicket(alex, ticket.ticketNumber);
    await expectLimited(issueQrForMyTicket(alex, ticket.ticketNumber));

    const sophiaTicket = await ticketOf(EMAILS.sophia, "FRI");
    await expect(issueQrForMyTicket(sophia, sophiaTicket.ticketNumber)).resolves.toMatchObject({ token: expect.stringMatching(/^CJ1\./) });

    await ageBucket(key, window + 5);
    await expect(issueQrForMyTicket(alex, ticket.ticketNumber)).resolves.toMatchObject({ token: expect.stringMatching(/^CJ1\./) });
  });
});

describe("scan per staff (1200 / h)", () => {
  const { limit, window } = RATE_LIMITS.scanPerStaff;

  it("exact key format: 1200 hits pass, the 1201st is refused and scan() is refused too", { timeout: 180_000 }, async () => {
    const staff = await makeUser("CHECK_IN_STAFF");
    for (let i = 0; i < limit; i++) await enforceRateLimit(`scan:${staff.id}`, limit, window);
    await expectLimited(enforceRateLimit(`scan:${staff.id}`, limit, window));
    await expectLimited(scan(staffActor(staff), { ticketNumber: "NOPE-000", zoneId: await zoneId("MAIN") }));
    expect(await db.ticketScanLog.count({ where: { staffUserId: staff.id } })).toBe(0);
  });

  it("scan(): calls 1199 and 1200 are logged, 1201 refused without a log; other staff unaffected; window resets", async () => {
    const staff = await makeUser("CHECK_IN_STAFF");
    const actor = staffActor(staff);
    const main = await zoneId("MAIN");
    await presetBucket(`scan:${staff.id}`, limit - 2);
    for (let i = 0; i < 2; i++) await expect(scan(actor, { ticketNumber: "NOPE-000", zoneId: main })).resolves.toMatchObject({ result: "INVALID" });
    await expectLimited(scan(actor, { ticketNumber: "NOPE-000", zoneId: main }));
    expect(await db.ticketScanLog.count({ where: { staffUserId: staff.id } })).toBe(2);

    const other = await makeUser("CHECK_IN_STAFF");
    await expect(scan(staffActor(other), { ticketNumber: "NOPE-000", zoneId: main })).resolves.toMatchObject({ result: "INVALID" });

    await ageBucket(`scan:${staff.id}`, window + 5);
    await expect(scan(actor, { ticketNumber: "NOPE-000", zoneId: main })).resolves.toMatchObject({ result: "INVALID" });
    expect(await db.ticketScanLog.count({ where: { staffUserId: staff.id } })).toBe(3);
  });
});

// ─── concierge ──────────────────────────────────────────────────────────────

describe("concierge requests per member (20 / h) and messages per user (60 / h)", () => {
  const perMember = RATE_LIMITS.conciergePerMember;
  const perUser = RATE_LIMITS.conciergeMessagePerUser;
  const input = { category: "DINING" as const, subject: "Rate limit test", description: "Table please" };

  it("20 requests, the 21st refused with its own message and nothing stored; other member unaffected; window resets", { timeout: 60_000 }, async () => {
    const { actor } = await makeMember();
    for (let i = 0; i < perMember.limit; i++) await createRequest(actor, input);
    await expectLimited(
      createRequest(actor, input),
      "You have sent a lot of requests in the last hour. Please message concierge on an existing request instead.",
    );
    expect(await db.conciergeRequest.count({ where: { memberId: actor.memberId! } })).toBe(perMember.limit);

    const other = await makeMember();
    await expect(createRequest(other.actor, input)).resolves.toMatchObject({ memberId: other.actor.memberId });

    await ageBucket(`concierge:${actor.memberId}`, perMember.window + 5);
    await createRequest(actor, input);
    expect(await db.conciergeRequest.count({ where: { memberId: actor.memberId! } })).toBe(perMember.limit + 1);
  });

  it("parallel: 25 simultaneous requests → exactly 20 stored", { timeout: 60_000 }, async () => {
    const { actor } = await makeMember();
    const r = await settle(Array.from({ length: 25 }, () => createRequest(actor, input)));
    expect(r.ok).toBe(perMember.limit);
    expect(r.codes).toEqual(Array(5).fill("RATE_LIMITED"));
    expect(await db.conciergeRequest.count({ where: { memberId: actor.memberId! } })).toBe(perMember.limit);
  });

  it("60 messages, the 61st refused and not stored; staff on the same request unaffected; window resets", { timeout: 60_000 }, async () => {
    const { actor } = await makeMember();
    const req = await createRequest(actor, input);
    const mine = () => db.conciergeRequestMessage.count({ where: { requestId: req.id, senderId: actor.userId } });
    for (let i = 0; i < perUser.limit; i++) await addMessage(actor, req.id, { message: `m${i}` });
    await expectLimited(addMessage(actor, req.id, { message: "one too many" }));
    expect(await mine()).toBe(perUser.limit);

    const concierge = await actorFor(EMAILS.concierge);
    seededKeys.add(`concierge-msg:${concierge.userId}`);
    await addMessage(concierge, req.id, { message: "Noted." }); // would throw if limited
    expect(await db.conciergeRequestMessage.count({ where: { requestId: req.id, senderId: concierge.userId } })).toBe(1);

    await ageBucket(`concierge-msg:${actor.userId}`, perUser.window + 5);
    await addMessage(actor, req.id, { message: "after the window" });
    expect(await mine()).toBe(perUser.limit + 1);
  });
});

describe("concierge attachments count against the upload limit (30 / h, shared with photos)", () => {
  const { limit } = RATE_LIMITS.uploadPerUser;
  const input = { category: "DINING" as const, subject: "Attachment test", description: "See attached" };

  it("the 30th upload (an attachment) passes, then attachments and photos are refused; plain messages still work", async () => {
    const { actor } = await makeMember();
    await presetBucket(`upload:${actor.userId}`, limit - 1);
    const req = await createRequest(actor, input, png()); // upload 30
    const files = () => db.storedFile.count({ where: { ownerUserId: actor.userId } });
    expect(await files()).toBe(1);

    // a request with an attachment is refused as a whole (nothing created), one without works
    const before = await db.conciergeRequest.count({ where: { memberId: actor.memberId! } });
    await expectLimited(createRequest(actor, input, png()));
    expect(await db.conciergeRequest.count({ where: { memberId: actor.memberId! } })).toBe(before);
    await createRequest(actor, input);

    const msgs = () => db.conciergeRequestMessage.count({ where: { requestId: req.id, senderId: actor.userId } });
    const m0 = await msgs();
    await expectLimited(addMessage(actor, req.id, { message: "with file" }, png()));
    expect(await msgs()).toBe(m0);
    await addMessage(actor, req.id, { message: "no file" });
    expect(await msgs()).toBe(m0 + 1);

    await expectLimited(setMyPhoto(actor, png())); // same key as profile photos
    expect(await files()).toBe(1);
    expect((await bucket(`upload:${actor.userId}`))?.count).toBe(limit + 3);
  });
});

describe("cron route prunes old rate-limit buckets", () => {
  it("deletes buckets whose window started more than 2 days ago and keeps the rest", async () => {
    const old = `test:prune-old:${uid()}`;
    const recent = `test:prune-recent:${uid()}`;
    const current = `test:prune-now:${uid()}`;
    await presetBucket(old, 3);
    await presetBucket(recent, 3);
    await presetBucket(current, 3);
    await ageBucket(old, 2 * 24 * 3600 + 60);
    await ageBucket(recent, 2 * 24 * 3600 - 3600); // e.g. a finished 24 h export window: still kept

    headerStore.current = new Headers({ authorization: "Bearer wrong" });
    expect((await cronGet()).status).toBe(401);
    expect(await bucket(old)).not.toBeNull();

    headerStore.current = new Headers({ authorization: `Bearer ${process.env.CRON_SECRET}` });
    const res = await cronGet();
    expect(res.status).toBe(200);
    expect((await res.json()).prunedRateLimitBuckets).toBeGreaterThanOrEqual(1);
    expect(await bucket(old)).toBeNull();
    expect(await bucket(recent)).not.toBeNull();
    expect(await bucket(current)).not.toBeNull();
    headerStore.current = new Headers();
  });
});

// ─── uploads and export ─────────────────────────────────────────────────────

describe("profile photo upload per user (30 / h)", () => {
  const { limit, window } = RATE_LIMITS.uploadPerUser;

  it("30 uploads, the 31st refused and nothing stored; other user unaffected; window resets", { timeout: 60_000 }, async () => {
    const { actor } = await makeMember();
    const photoKey = async () => (await db.member.findUniqueOrThrow({ where: { id: actor.memberId! } })).profilePhotoKey;
    const files = () => db.storedFile.count({ where: { ownerUserId: actor.userId } });
    for (let i = 0; i < limit; i++) await setMyPhoto(actor, png());
    const keyBefore = await photoKey();
    const filesBefore = await files();
    expect(filesBefore).toBe(1); // each upload replaces the previous photo

    await expectLimited(setMyPhoto(actor, png()));
    expect(await photoKey()).toBe(keyBefore);
    expect(await files()).toBe(filesBefore);

    const other = await makeMember();
    await setMyPhoto(other.actor, png());
    await removeMyPhoto(other.actor);

    await ageBucket(`upload:${actor.userId}`, window + 5);
    await setMyPhoto(actor, png());
    expect(await photoKey()).not.toBe(keyBefore);
    await removeMyPhoto(actor);
  });
});

describe("data export per user (5 / 24 h)", () => {
  const { limit, window } = RATE_LIMITS.exportPerUser;

  it("5 exports, the 6th refused and not audited; other member unaffected; window resets after 24 h", async () => {
    const { actor } = await makeMember();
    for (let i = 0; i < limit; i++) await expect(exportMyData(actor)).resolves.toMatchObject({ format: expect.any(String) });
    await expectLimited(exportMyData(actor));
    expect(await audits("member.data_export", actor.memberId!)).toBe(limit);

    const other = await makeMember();
    await expect(exportMyData(other.actor)).resolves.toBeTruthy();

    await ageBucket(`export:${actor.userId}`, 23 * 3600);
    await expectLimited(exportMyData(actor));
    await ageBucket(`export:${actor.userId}`, window + 5);
    await expect(exportMyData(actor)).resolves.toBeTruthy();
    expect(await audits("member.data_export", actor.memberId!)).toBe(limit + 1);
  });

  it("parallel: 8 simultaneous exports → exactly 5 succeed", async () => {
    const { actor } = await makeMember();
    const r = await settle(Array.from({ length: 8 }, () => exportMyData(actor)));
    expect(r.ok).toBe(limit);
    expect(r.codes).toEqual(Array(3).fill("RATE_LIMITED"));
  });
});
