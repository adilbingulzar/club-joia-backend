import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { authenticate, validateSessionToken } from "@/services/auth.service";
import { resetMfa, startMfaEnrolment, verifyMfaCode } from "@/services/mfa.service";
import { totpCode, totpStep } from "@/lib/security/totp";
import { actorFor, EMAILS } from "../support/actors";

const STAFF_PW = "JoiaDev!2026-staff";
const meta = { ipAddress: "10.0.1.1", userAgent: "vitest" };

async function pending(email: string) {
  const r = await authenticate(email, STAFF_PW, meta);
  const user = await validateSessionToken(r.token, { allowMfaPending: true });
  return { token: r.token, user: user! };
}

describe("two-factor sign-in for admins", () => {
  it("keeps an admin signed out until a code is confirmed, then lets them in", async () => {
    const { token, user } = await pending(EMAILS.manager);
    expect(user).toMatchObject({ mfaPending: true, mfaEnabled: false });
    // pages, actions and APIs see no session yet
    expect(await validateSessionToken(token)).toBeNull();

    const { secret } = await startMfaEnrolment(user);
    // reloading the set-up page keeps the same secret
    expect((await startMfaEnrolment(user)).secret).toBe(secret);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored.mfaSecretEncrypted).not.toContain(secret);

    await expect(verifyMfaCode(user, "000000", meta)).rejects.toMatchObject({ code: "VALIDATION" });
    const step = totpStep();
    await verifyMfaCode(user, totpCode(secret, step), meta);
    expect(await validateSessionToken(token)).toMatchObject({ email: EMAILS.manager, mfaPending: false, mfaEnabled: true });

    // next sign-in: the same code is refused, a newer one works
    const again = await pending(EMAILS.manager);
    expect(again.user.mfaEnabled).toBe(true);
    await expect(verifyMfaCode(again.user, totpCode(secret, step), meta)).rejects.toMatchObject({ code: "VALIDATION" });
    await verifyMfaCode(again.user, totpCode(secret, step + 1), meta);
    expect(await validateSessionToken(again.token)).not.toBeNull();
    await expect(startMfaEnrolment({ ...again.user })).rejects.toMatchObject({ code: "INVALID_STATE" });

    // a super admin resets it (lost phone): signed out, set up again next time
    await resetMfa(await actorFor(EMAILS.admin), user.userId);
    expect(await validateSessionToken(again.token)).toBeNull();
    const after = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(after).toMatchObject({ mfaEnabled: false, mfaSecretEncrypted: null, mfaLastUsedStep: null });
  });

  it("ends the session after too many wrong codes", async () => {
    const { token, user } = await pending(EMAILS.admin);
    await startMfaEnrolment(user);
    let last: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        await verifyMfaCode(user, "111111", meta);
      } catch (e) {
        last = e;
      }
    }
    expect(last).toMatchObject({ code: "RATE_LIMITED" });
    expect(await validateSessionToken(token, { allowMfaPending: true })).toBeNull();
  });

  it("asks nothing of members and other staff", async () => {
    const r = await authenticate(EMAILS.concierge, STAFF_PW, meta);
    expect(await validateSessionToken(r.token)).toMatchObject({ role: "CONCIERGE", mfaPending: false });
    await expect(resetMfa(await actorFor(EMAILS.manager), r.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
