import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { allowed, clientIp, parseAllowlist } from "@/lib/security/ip-allowlist";
import { forgetIpAllowlist } from "@/lib/security/ip-allowlist-store";

// the admin's list (table ip_allowlist)
const panel = vi.hoisted(() => ({ rows: [] as { address: string }[], reads: 0 }));
vi.mock("@/lib/db", () => ({
  db: {
    ipAllowlistEntry: {
      findMany: async () => {
        panel.reads++;
        return panel.rows;
      },
    },
  },
}));

const visit = (path: string, ip: string, cookie = "") =>
  proxy(new NextRequest("https://app.example.com" + path, { headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } }));
const status = async (path: string, ip: string, cookie = "") => (await visit(path, ip, cookie)).status;

beforeEach(() => {
  panel.rows = [];
  panel.reads = 0;
  forgetIpAllowlist();
});
afterEach(() => vi.unstubAllEnvs());

describe("IP allowlist", () => {
  it("lets nobody in while IP_ALLOWLIST and the admin's list are both empty", async () => {
    vi.stubEnv("IP_ALLOWLIST", "");
    expect(await status("/login", "198.51.100.1")).toBe(403);
    expect(await status("/admin/ip-allowlist", "127.0.0.1")).toBe(403);
  });

  it("refuses everything, APIs and files included, to other addresses", async () => {
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7, 10.0.0.0/8");
    for (const path of ["/", "/login", "/admin/login", "/admin", "/staff/scanner", "/api/cron/notifications", "/api/files/x", "/_next/static/chunks/a.js", "/sw.js", "/brand/logo.png"]) {
      const r = await visit(path, "198.51.100.1");
      expect(r.status, path).toBe(403);
      expect(await r.text()).toBe("Access denied.");
    }
    expect(await status("/login", "203.0.113.7")).toBe(200);
    expect(await status("/api/files/x", "10.1.2.3")).toBe(200);
  });

  it("leaves the scanner API (which has its own key) open to every address", async () => {
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    expect(await status("/api/scan/tickets", "198.51.100.1")).toBe(200);
    expect(await status("/api/scan/tickets/t1", "198.51.100.1")).toBe(200);
    expect(await status("/api/scanner", "198.51.100.1")).toBe(403);
    expect(await status("/staff/scanner", "198.51.100.1")).toBe(403);
  });

  it("lets in the admin's addresses and IP_ALLOWLIST's together", async () => {
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    panel.rows = [{ address: "198.51.100.0/24" }];
    expect(await status("/login", "198.51.100.9")).toBe(200);
    expect(await status("/login", "203.0.113.7")).toBe(200);
    expect(await status("/login", "192.0.2.1")).toBe(403);
  });

  it("works with only the admin's list, and reads it again after a change", async () => {
    vi.stubEnv("IP_ALLOWLIST", "");
    panel.rows = [{ address: "198.51.100.9" }];
    expect(await status("/login", "192.0.2.1")).toBe(403);
    expect(await status("/login", "198.51.100.9")).toBe(200);
    expect(panel.reads).toBe(1); // kept for 30 seconds
    panel.rows = [{ address: "192.0.2.1" }];
    forgetIpAllowlist();
    expect(await status("/login", "192.0.2.1")).toBe(200);
    expect(await status("/login", "198.51.100.9")).toBe(403);
  });

  it("then sends signed-out visitors of private pages to sign in, as before", async () => {
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    const r = await visit("/admin/members", "203.0.113.7");
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/admin/login");
    expect(await status("/admin/members", "203.0.113.7", "joia_session=x")).toBe(200);
    expect(await status("/api/anything", "203.0.113.7")).toBe(200);
  });

  it("takes the last X-Forwarded-For entry (nginx's), so a spoofed first one doesn't help", async () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" }))).toBe("198.51.100.1");
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    expect(await status("/login", "203.0.113.7, 198.51.100.1")).toBe(403);
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
