import { describe, expect, it } from "vitest";
import { signQrToken, verifyQrToken } from "@/lib/qr/token";

const keys = { current: "k".repeat(40) };
const now = new Date("2026-12-04T10:00:00Z");

describe("QR signing", () => {
  it("produces a compact CJ1 token without personal data", () => {
    const { token, expiresAt } = signQrToken("cred-ref-abc", keys, 300, now);
    expect(token.startsWith("CJ1.")).toBe(true);
    expect(token.split(".")).toHaveLength(3);
    expect(token.length).toBeLessThan(160);
    expect(expiresAt.getTime()).toBe(now.getTime() + 300_000);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(["e", "n", "r"]);
  });

  it("issues a unique token each time (nonce)", () => {
    const a = signQrToken("ref", keys, 300, now).token;
    const b = signQrToken("ref", keys, 300, now).token;
    expect(a).not.toBe(b);
  });
});

describe("QR verification", () => {
  it("accepts a valid token", () => {
    const { token } = signQrToken("ref-1", keys, 300, now);
    const r = verifyQrToken(token, keys, new Date(now.getTime() + 60_000));
    expect(r).toMatchObject({ ok: true, credentialRef: "ref-1" });
  });

  it("rejects a tampered payload", () => {
    const { token } = signQrToken("ref-1", keys, 300, now);
    const [p, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ r: "someone-else", n: "x", e: 9999999999 })).toString("base64url");
    expect(verifyQrToken(`${p}.${forged}.${s}`, keys, now)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("rejects a token signed with another secret", () => {
    const { token } = signQrToken("ref-1", { current: "x".repeat(40) }, 300, now);
    expect(verifyQrToken(token, keys, now)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("reports expiry (after the skew allowance) but still identifies the credential", () => {
    const { token } = signQrToken("ref-1", keys, 60, now);
    expect(verifyQrToken(token, keys, new Date(now.getTime() + 70_000)).ok).toBe(true); // within 15s skew
    expect(verifyQrToken(token, keys, new Date(now.getTime() + 80_000))).toMatchObject({ ok: false, reason: "EXPIRED", credentialRef: "ref-1" });
  });

  it("rejects malformed input", () => {
    for (const t of ["", "hello", "CJ2.a.b", "CJ1.a", "CJ1..", "x".repeat(600)]) {
      expect(verifyQrToken(t, keys, now).ok).toBe(false);
    }
  });

  it("accepts tokens signed with the previous secret during rotation", () => {
    const old = { current: "o".repeat(40) };
    const { token } = signQrToken("ref-1", old, 300, now);
    expect(verifyQrToken(token, { current: "n".repeat(40), previous: old.current }, now).ok).toBe(true);
    expect(verifyQrToken(token, { current: "n".repeat(40) }, now).ok).toBe(false);
  });
});
