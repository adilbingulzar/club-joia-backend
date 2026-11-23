import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// env() is parsed once, on first use, so the driver must be set before the service is loaded.
beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: "mysql://u:p@localhost:3306/x",
    AUTH_SECRET: "a".repeat(40),
    QR_SIGNING_SECRET: "q".repeat(40),
    EMAIL_DRIVER: "postmark",
    EMAIL_FROM: "CLUB JOIA 300 <cs@example.com>",
    POSTMARK_SERVER_TOKEN: "test-token",
    POSTMARK_MESSAGE_STREAM: "outbound",
  });
});

afterEach(() => vi.unstubAllGlobals());

const load = () => import("@/services/email.service");

describe("composeEmail", () => {
  it("escapes every value in the HTML body and keeps the raw values in the text body", async () => {
    const { composeEmail } = await load();
    const mail = composeEmail({
      subject: "Hi <b>",
      greeting: "Dear <script>alert(1)</script>,",
      intro: ['Tom & "Jerry"'],
      details: [["Subject", "<img src=x>"]],
      action: { label: "Open", url: "https://app.example/x?a=1&b=2" },
      signOff: "CLUB JOIA 300",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain('href="https://app.example/x?a=1&amp;b=2"');
    expect(mail.text).toContain("Dear <script>alert(1)</script>,");
    expect(mail.text).toContain("Subject: <img src=x>");
    expect(mail.text).toContain("Open:\nhttps://app.example/x?a=1&b=2");
  });

  it("puts the activation link in both bodies", async () => {
    const { activationEmail } = await load();
    const mail = activationEmail("Sara", "https://app.example/activate?token=abc");
    expect(mail.text).toContain("https://app.example/activate?token=abc");
    expect(mail.html).toContain('href="https://app.example/activate?token=abc"');
    expect(mail.tag).toBe("activation");
  });
});

describe("postmark driver", () => {
  it("sends HTML + text on the configured stream with tracking off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ErrorCode: 0, MessageID: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendEmail, passwordResetEmail } = await load();

    const res = await sendEmail({ to: "member@example.com", ...passwordResetEmail("Sara", "https://app.example/r?t=1") });

    expect(res).toEqual({ delivered: true, driver: "postmark" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init.headers["X-Postmark-Server-Token"]).toBe("test-token");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      From: "CLUB JOIA 300 <cs@example.com>",
      To: "member@example.com",
      MessageStream: "outbound",
      Tag: "password-reset",
      TrackLinks: "None",
      TrackOpens: false,
    });
    expect(body.HtmlBody).toContain("<!doctype html>");
    expect(body.TextBody).toContain("https://app.example/r?t=1");
  });

  it("reports a rejected message as not delivered, with Postmark's reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ErrorCode: 400, Message: "Sender signature not confirmed" }), { status: 422 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmail } = await load();

    const res = await sendEmail({ to: "member@example.com", subject: "s", text: "t" });

    expect(res.delivered).toBe(false);
    expect(res.error).toContain("Sender signature not confirmed");
  });
});
