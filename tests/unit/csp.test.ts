import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "@/lib/security/csp";
import { proxy } from "@/proxy";

// the proxy reads the admin's IP allowlist; none here
vi.mock("@/lib/db", () => ({ db: { ipAllowlistEntry: { findMany: async () => [] } } }));

const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];
// from an allowed address (IP_ALLOWLIST), so the request goes on to the page
const visit = (path: string, cookie?: string) =>
  proxy(new NextRequest("https://app.example.com" + path, { headers: { "x-forwarded-for": "203.0.113.7", ...(cookie ? { cookie } : {}) } }));

beforeEach(() => vi.stubEnv("IP_ALLOWLIST", "203.0.113.7"));
afterEach(() => vi.unstubAllEnvs());

describe("content security policy", () => {
  it("runs no inline script without this request's nonce", () => {
    const policy = contentSecurityPolicy("abc", { dev: false, https: true });
    expect(policy).toContain("script-src 'self' 'nonce-abc';");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).not.toMatch(/https?:|\*/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("abc", { dev: true, https: false })).toContain("script-src 'self' 'nonce-abc' 'unsafe-eval';");
    expect(contentSecurityPolicy("abc", { dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("gives every answer a fresh nonce, and hands it to the page that renders", async () => {
    const seen = new Set<string>();
    for (const [path, cookie] of [["/login"], ["/admin/sales"], ["/admin/sales", "joia_session=x"], ["/api/me"], ["/icons/icon-192.png"]] as [string, string?][]) {
      const res = await visit(path, cookie);
      const nonce = nonceOf(res.headers.get("content-security-policy") ?? "");
      expect(nonce, path).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      seen.add(nonce!);
    }
    expect(seen.size).toBe(5);
    const page = await visit("/admin/sales", "joia_session=x");
    const nonce = nonceOf(page.headers.get("content-security-policy") ?? "");
    // NextResponse.next({ request: { headers } }) passes request headers on as x-middleware-request-*
    expect(page.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(page.headers.get("x-middleware-request-content-security-policy")).toContain(`'nonce-${nonce}'`);
  });

  it("leaves uploaded files their own sandboxed policy", async () => {
    expect((await visit("/api/files/abc")).headers.get("content-security-policy")).toBeNull();
  });
});
