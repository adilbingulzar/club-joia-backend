import { hmacSha256, randomToken, safeEqual } from "@/lib/crypto";

/**
 * Signed QR access tokens.
 *
 *   CJ1.<payload>.<signature>
 *
 * payload   = base64url(JSON { r, n, e })
 *   r  credential reference — random, opaque, maps server-side to a ticket credential
 *   n  nonce — makes every issued token unique
 *   e  expiry, unix seconds
 * signature = base64url(HMAC-SHA256(secret, "CJ1." + payload))
 *
 * Secret rotation: tokens are always signed with the current secret; verification also
 * accepts the previous secret (QR_SIGNING_SECRET_PREVIOUS) so codes already on screens keep
 * working until they expire.
 *
 * The token contains no personal data and no database ids. Possession of a valid token
 * proves only that the server issued it for that credential recently; every scan is still
 * checked against live ticket/membership state.
 */
export const QR_PREFIX = "CJ1";

export type QrPayload = { r: string; n: string; e: number };

export type QrKeys = { current: string; previous?: string };

export type QrVerifyResult =
  | { ok: true; credentialRef: string; expiresAt: Date; nonce: string }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED"; credentialRef?: string };

function sign(secret: string, payloadB64: string): string {
  return hmacSha256(secret, `${QR_PREFIX}.${payloadB64}`).toString("base64url");
}

export function signQrToken(
  credentialRef: string,
  keys: QrKeys,
  ttlSeconds: number,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload: QrPayload = { r: credentialRef, n: randomToken(6), e: exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${QR_PREFIX}.${payloadB64}.${sign(keys.current, payloadB64)}`,
    expiresAt: new Date(exp * 1000),
  };
}

/** Clock-skew allowance for scanner devices whose clocks drift slightly. */
const SKEW_SECONDS = 15;

export function verifyQrToken(token: string, keys: QrKeys, now: Date = new Date()): QrVerifyResult {
  if (typeof token !== "string" || token.length > 512) return { ok: false, reason: "MALFORMED" };
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) return { ok: false, reason: "MALFORMED" };
  const [, payloadB64, sigB64] = parts;

  // Authenticate before parsing anything attacker-controlled.
  const given = Buffer.from(sigB64, "base64url");
  const secrets = keys.previous ? [keys.current, keys.previous] : [keys.current];
  const signatureOk = secrets.some((secret) =>
    safeEqual(Buffer.from(sign(secret, payloadB64), "base64url"), given),
  );
  if (!signatureOk) return { ok: false, reason: "BAD_SIGNATURE" };

  let payload: QrPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (
    !payload ||
    typeof payload.r !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.e !== "number"
  ) {
    return { ok: false, reason: "MALFORMED" };
  }

  if (payload.e + SKEW_SECONDS < Math.floor(now.getTime() / 1000)) {
    // Signature is genuine, so the credential ref is trustworthy for logging.
    return { ok: false, reason: "EXPIRED", credentialRef: payload.r };
  }
  return { ok: true, credentialRef: payload.r, expiresAt: new Date(payload.e * 1000), nonce: payload.n };
}
