import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(secret: string, input: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

/** Keyed hash for secrets stored at rest (session/activation tokens). */
export function hashSecretToken(token: string, pepper: string): string {
  return hmacSha256(pepper, token).toString("hex");
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

const HUMAN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I

/** Short human-readable code (for ticket / request references). ~5 bits per char. */
export function humanCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += HUMAN_ALPHABET[bytes[i] % HUMAN_ALPHABET.length];
  return out;
}
