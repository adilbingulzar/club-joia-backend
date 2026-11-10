import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { authenticate, issueActivation, activateAccount, revokeAllSessions, validateSessionToken } from "@/services/auth.service";
import { createMember } from "@/services/member.service";
import { actorFor, EMAILS } from "../support/actors";

const MEMBER_PW = "JoiaDev!2026-member";
const meta = { ipAddress: "10.0.0.1", userAgent: "vitest" };

describe("member login", () => {
  it("signs in with the right password and creates a revocable session", async () => {
    const r = await authenticate(EMAILS.alex, MEMBER_PW, meta);
    expect(r.role).toBe("MEMBER");
    const session = await validateSessionToken(r.token);
    expect(session).toMatchObject({ email: EMAILS.alex, role: "MEMBER" });
    expect(session?.memberId).toBeTruthy();

    // Only a keyed hash of the token is stored.
    const raw = await db.session.findMany({ where: { tokenHash: r.token } });
    expect(raw).toHaveLength(0);

    await revokeAllSessions(r.userId);
    expect(await validateSessionToken(r.token)).toBeNull();
  });

  it("rejects a wrong password with a generic message", async () => {
    await expect(authenticate(EMAILS.alex, "wrong-password-123", { ipAddress: "10.0.0.2" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      message: expect.stringContaining("Email or password is incorrect."),
    });
    await expect(authenticate("nobody@joia.test", "whatever-123456", { ipAddress: "10.0.0.2" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("gives staff short sessions", async () => {
    const r = await authenticate(EMAILS.scanner, "JoiaDev!2026-staff", { ipAddress: "10.0.0.3" });
    expect(r.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3600 * 1000 + 1000);
  });

  it("rate-limits repeated attempts for one email", async () => {
    const ip = { ipAddress: "10.0.0.9" };
    let lastError: unknown;
    for (let i = 0; i < 10; i++) {
      try {
        await authenticate(EMAILS.marcus, "definitely-wrong-pw", ip);
      } catch (e) {
        lastError = e;
      }
    }
    expect(lastError).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("runs the invitation → activation flow", async () => {
    const admin = await actorFor(EMAILS.admin);
    const tier = await db.membershipTier.findUniqueOrThrow({ where: { slug: "ruby-red" } });
    const { memberId, activation } = await createMember(admin, { firstName: "Nora", lastName: "Test", email: "nora@joia.test", tierId: tier.id, sendInvitation: true });
    expect(activation?.link).toContain("/activate?token=");
    // Not yet activated: same generic answer as an unknown email (no membership disclosure).
    await expect(authenticate("nora@joia.test", "anything-long-1", { ipAddress: "10.0.0.20" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const token = new URL(activation!.link).searchParams.get("token")!;
    const session = await activateAccount(token, "Nora-Password-2026", meta);
    expect(await validateSessionToken(session.token)).toMatchObject({ email: "nora@joia.test" });
    const membership = await db.membership.findFirstOrThrow({ where: { memberId } });
    expect(membership.status).toBe("ACTIVE");
    expect(await db.consentRecord.count({ where: { user: { email: "nora@joia.test" } } })).toBe(2);
    // Single-use.
    await expect(activateAccount(token, "Another-Password-1", meta)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(issueActivation((await db.member.findUniqueOrThrow({ where: { id: memberId } })).userId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
