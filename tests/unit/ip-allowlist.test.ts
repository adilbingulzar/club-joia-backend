import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { allowed, clientIp, parseAllowlist } from "@/lib/security/ip-allowlist";

const visit = (path: string, ip: string, cookie = "") =>
  proxy(new NextRequest("https://app.example.com" + path, { headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } }));

afterEach(() => vi.unstubAllEnvs());

describe("IP allowlist", () => {
  it("is off while IP_ALLOWLIST is empty", () => {
    vi.stubEnv("IP_ALLOWLIST", "");
    expect(visit("/login", "198.51.100.1").status).toBe(200);
  });

  it("refuses everything, APIs and files included, to other addresses", async () => {
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7, 10.0.0.0/8");
    for (const path of ["/", "/login", "/admin/login", "/admin", "/staff/scanner", "/api/cron/notifications", "/api/files/x", "/_next/static/chunks/a.js", "/sw.js", "/brand/logo.png"]) {
      const r = visit(path, "198.51.100.1");
      expect(r.status, path).toBe(403);
      expect(await r.text()).toBe("Access denied.");
    }
    expect(visit("/login", "203.0.113.7").status).toBe(200);
    expect(visit("/api/files/x", "10.1.2.3").status).toBe(200);
  });

  it("then sends signed-out visitors of private pages to sign in, as before", () => {
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    const r = visit("/admin/members", "203.0.113.7");
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/admin/login");
    expect(visit("/admin/members", "203.0.113.7", "joia_session=x").status).toBe(200);
    expect(visit("/api/anything", "203.0.113.7").status).toBe(200);
  });

  it("takes the last X-Forwarded-For entry (nginx's), so a spoofed first one doesn't help", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" }))).toBe("198.51.100.1");
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    expect(visit("/login", "203.0.113.7, 198.51.100.1").status).toBe(403);
  });

  it("reads addresses and ranges", () => {
    const r = parseAllowlist("127.0.0.1 ::1,192.168.1.0/24 bad");
    expect(r).toHaveLength(3);
    expect(allowed("::ffff:127.0.0.1", r)).toBe(true);
    expect(allowed("::1", r)).toBe(true);
    expect(allowed("192.168.1.9", r)).toBe(true);
    expect(allowed("192.168.2.9", r)).toBe(false);
  });
});
