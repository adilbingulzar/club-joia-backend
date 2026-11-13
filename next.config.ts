import type { NextConfig } from "next";

/** Only force HTTPS behaviour when the app is actually served over HTTPS (not local `next start`). */
const isHttps = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");

// Content-Security-Policy is set per request (a fresh nonce each time) by src/proxy.ts, see
// src/lib/security/csp.ts.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(!isHttps ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  // Separate build dirs let E2E (`next start` on a test DB) run beside `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // No Cache Components (static shells): every page is rendered per request, so it can carry the
  // request's script nonce (src/lib/security/csp.ts).
  poweredByHeader: false,
  // Development only: let phones on the local network load the dev server (`npm run dev:lan`),
  // e.g. to test the scanner camera. Has no effect on production builds.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local", ...(process.env.DEV_ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [])],
  serverExternalPackages: ["@node-rs/argon2", "web-push", "nodemailer"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
