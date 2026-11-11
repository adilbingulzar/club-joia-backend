import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  matchTotp,
  totpCode,
  totpStep,
  totpUri,
} from "@/lib/security/totp";

// RFC 6238 appendix B (SHA-1): the secret is the ASCII text "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const KEY = "test-mfa-key-test-mfa-key-test-mfa-key";

describe("totp", () => {
  it("matches the RFC 6238 test values (last 6 digits)", () => {
    expect(totpCode(RFC_SECRET, totpStep(59_000))).toBe("287082");
    expect(totpCode(RFC_SECRET, totpStep(1_111_111_109_000))).toBe("081804");
    expect(totpCode(RFC_SECRET, totpStep(1_234_567_890_000))).toBe("005924");
    expect(totpCode(RFC_SECRET, totpStep(2_000_000_000_000))).toBe("279037");
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("accepts the current code and one step either side, nothing further", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "abcdef", now)).toBeNull();
  });

  it("encrypts the secret, and only the same key opens it", () => {
    const secret = generateTotpSecret();
    const blob = encryptTotpSecret(secret, KEY);
    expect(blob).not.toContain(secret);
    expect(decryptTotpSecret(blob, KEY)).toBe(secret);
    expect(() => decryptTotpSecret(blob, KEY + "x")).toThrow();
    expect(() => encryptTotpSecret(secret, "short")).toThrow();
  });

  it("builds the authenticator address", () => {
    expect(totpUri("ABC", "a@b.com")).toBe("otpauth://totp/CLUB%20JOIA%20300%3Aa%40b.com?secret=ABC&issuer=CLUB+JOIA+300&algorithm=SHA1&digits=6&period=30");
  });
});
