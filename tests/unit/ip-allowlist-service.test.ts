import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/services/context";

// an in-memory ip_allowlist table
const t = vi.hoisted(() => ({ rows: [] as { id: string; address: string; label: string; createdById: string | null; createdAt: Date }[], audits: [] as string[] }));
vi.mock("@/lib/db", () => ({
  db: {
    ipAllowlistEntry: {
      findMany: async ({ where }: { where?: { id?: { not: string } } } = {}) => t.rows.filter((r) => !where?.id || r.id !== where.id.not),
      findUnique: async ({ where }: { where: { id: string } }) => t.rows.find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: { address: string; label: string; createdById: string } }) => {
        const row = { id: "e" + (t.rows.length + 1), createdAt: new Date(), ...data };
        t.rows.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        t.rows = t.rows.filter((r) => r.id !== where.id);
      },
    },
  },
}));
vi.mock("@/services/audit.service", () => ({ recordAudit: async (_a: unknown, e: { action: string }) => void t.audits.push(e.action) }));

const { addIpAllowlistEntry, removeIpAllowlistEntry } = await import("@/services/ip-allowlist.service");

const superAdmin: Actor = { userId: "u1", role: "SUPER_ADMIN", memberId: null, ipAddress: "203.0.113.7" };

beforeEach(() => {
  t.rows = [];
  t.audits = [];
  vi.stubEnv("IP_ALLOWLIST", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("IP allowlist panel", () => {
  it("is for super admins only", async () => {
    await expect(addIpAllowlistEntry({ ...superAdmin, role: "ADMIN" }, { address: "203.0.113.7", label: "x" })).rejects.toThrow();
  });

  it("won't let the first address shut out the super admin adding it", async () => {
    await expect(addIpAllowlistEntry(superAdmin, { address: "198.51.100.1", label: "Office" })).rejects.toThrow(/block your own IP \(203\.0\.113\.7\)/);
    await addIpAllowlistEntry(superAdmin, { address: "203.0.113.0/24", label: "Peter" });
    await addIpAllowlistEntry(superAdmin, { address: "198.51.100.1", label: "Office" });
    expect(t.rows.map((r) => r.address)).toEqual(["203.0.113.0/24", "198.51.100.1"]);
    expect(t.audits).toEqual(["security.ip_allowlist_add", "security.ip_allowlist_add"]);
  });

  it("won't remove the address the super admin is using, unless IP_ALLOWLIST lets them in", async () => {
    await addIpAllowlistEntry(superAdmin, { address: "203.0.113.7", label: "Peter" });
    await addIpAllowlistEntry(superAdmin, { address: "198.51.100.1", label: "Office" });
    await expect(removeIpAllowlistEntry(superAdmin, "e1")).rejects.toThrow(/block your own IP/);
    await removeIpAllowlistEntry(superAdmin, "e2");
    await expect(removeIpAllowlistEntry(superAdmin, "e1")).rejects.toThrow(/block your own IP/); // an empty list lets nobody in
    vi.stubEnv("IP_ALLOWLIST", "203.0.113.7");
    await removeIpAllowlistEntry(superAdmin, "e1");
    expect(t.rows).toEqual([]);
    await addIpAllowlistEntry(superAdmin, { address: "198.51.100.1", label: "Office" });
  });

  it("takes only IP addresses and ranges, once each", async () => {
    for (const bad of ["example.com", "1.2.3", "10.0.0.0/33", "1.2.3.4 5.6.7.8"]) {
      await expect(addIpAllowlistEntry(superAdmin, { address: bad, label: "x" }), bad).rejects.toThrow(/valid IP/);
    }
    await addIpAllowlistEntry(superAdmin, { address: " 203.0.113.7 ", label: "Peter" });
    expect(t.rows[0].address).toBe("203.0.113.7");
    await expect(addIpAllowlistEntry(superAdmin, { address: "203.0.113.7", label: "Again" })).rejects.toThrow(/already/);
  });
});
