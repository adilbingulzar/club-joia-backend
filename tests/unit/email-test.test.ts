import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/services/context";

const m = vi.hoisted(() => ({ result: { delivered: true, driver: "postmark" } as { delivered: boolean; driver: string; error?: string }, sent: [] as unknown[], audits: [] as unknown[], allowed: true }));
vi.mock("@/services/email.service", () => ({ sendEmail: async (msg: unknown) => (m.sent.push(msg), m.result) }));
vi.mock("@/services/audit.service", () => ({ recordAudit: async (_a: unknown, e: unknown) => void m.audits.push(e) }));
vi.mock("@/lib/security/rate-limit", () => ({ hitRateLimit: async () => ({ allowed: m.allowed }) }));

const { sendTestEmail } = await import("@/services/email-test.service");
const superAdmin: Actor = { userId: "u1", role: "SUPER_ADMIN", memberId: null };
const mail = { to: "a@example.com", subject: "Test", text: "Hello" };

beforeEach(() => {
  m.result = { delivered: true, driver: "postmark" };
  m.sent = [];
  m.audits = [];
  m.allowed = true;
});

describe("test email page", () => {
  it("sends a plain email and logs it, for super admins only", async () => {
    await sendTestEmail(superAdmin, mail);
    expect(m.sent).toEqual([{ ...mail, tag: "test" }]);
    expect(m.audits).toHaveLength(1);
    await expect(sendTestEmail({ ...superAdmin, role: "SALES_VIEWER" }, mail)).rejects.toThrow();
  });

  it("says plainly when it wasn't sent", async () => {
    m.result = { delivered: false, driver: "console" };
    await expect(sendTestEmail(superAdmin, mail)).rejects.toThrow(/EMAIL_DRIVER=console/);
    m.result = { delivered: false, driver: "postmark", error: "Postmark responded 422 (400: Sender Signature not confirmed)" };
    await expect(sendTestEmail(superAdmin, mail)).rejects.toThrow(/postmark said: Postmark responded 422/);
    m.allowed = false;
    await expect(sendTestEmail(superAdmin, mail)).rejects.toThrow(/this hour/);
  });
});
