/**
 * Content Security Policy, set per request by src/proxy.ts.
 *
 * No inline script runs without this request's nonce: Next.js reads the nonce from the request's
 * Content-Security-Policy header and puts it on its own scripts. That only works for pages rendered
 * per request, so every page is (src/app/layout.tsx; Cache Components' static shells, built ahead
 * of time, could carry no nonce). Everything else is locked to our own origin.
 * Inline styles stay allowed (React's style attributes and next/font can't carry a nonce).
 * Development also needs 'unsafe-eval' (React's error overlay).
 */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function contentSecurityPolicy(
  nonce: string,
  opts: { dev?: boolean; https?: boolean } = {},
): string {
  const dev = opts.dev ?? process.env.NODE_ENV !== "production";
  const https = opts.https ?? (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
