import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, devices, expect, test, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { connectDatabase } from "../support/mysql-admin.mjs";

/**
 * End-to-end flows from the V1 spec:
 *   member: login → open ticket → see QR → programme → concierge request
 *   staff:  scan the member's real QR through the camera → VALID → check in
 *   admin:  revoke the ticket
 *   staff:  scan the same QR again → REVOKED
 * plus: staff-only sign-in page, the "Photo of QR" scanner fallback (phones without live camera
 * access), saved programme items in red, and creating a new event with an uploaded hero image.
 * The scanner's camera is fed a generated video of the member's QR code (Chromium fake capture).
 */
test.describe.configure({ mode: "serial" });

const MEMBER_PW = "JoiaDev!2026-member";
const STAFF_PW = "JoiaDev!2026-staff";
const qrVideo = path.resolve("test-results/member-qr.y4m");
let ticketNumber = "";
let qrToken = "";

async function login(page: Page, email: string, password: string, loginPath = "/login") {
  await page.goto(loginPath);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== loginPath);
}

/** Writes a looping Y4M video (grayscale) containing the QR code, for Chromium's fake camera. */
async function writeQrVideo(token: string) {
  const qr = QRCode.create(token, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const W = 640, H = 480;
  const scale = Math.floor(360 / (size + 8));
  const offX = Math.floor((W - size * scale) / 2), offY = Math.floor((H - size * scale) / 2);
  const y = Buffer.alloc(W * H, 255);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (qr.modules.get(r, c))
        for (let dy = 0; dy < scale; dy++) y.fill(0, (offY + r * scale + dy) * W + offX + c * scale, (offY + r * scale + dy) * W + offX + (c + 1) * scale);
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, uv]);
  mkdirSync(path.dirname(qrVideo), { recursive: true });
  writeFileSync(qrVideo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}

async function scannerPage() {
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${qrVideo}`],
  });
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:3100", permissions: ["camera"] });
  const page = await context.newPage();
  await login(page, "scanner@joia.test", STAFF_PW, "/admin/login");
  await expect(page).toHaveURL(/\/staff\/scanner/);
  return { page, close: () => browser.close() };
}

test.beforeAll(async () => {
  const db = await connectDatabase(readFileSync(".data/e2e-db-url", "utf8").trim());
  const rows = await db.query(
    `SELECT t.ticket_number FROM tickets t JOIN members m ON m.id = t.member_id JOIN ticket_types tt ON tt.id = t.ticket_type_id
     WHERE m.first_name = 'Alex' AND tt.code = 'FRI'`,
  );
  ticketNumber = rows[0].ticket_number;
  await db.end();
});

test("member: login, ticket QR, programme, concierge", async ({ page }) => {
  await login(page, "alex.carter@joia.test", MEMBER_PW);
  await expect(page.getByRole("heading", { name: "Alex" })).toBeVisible();

  await page.goto(`/tickets/${ticketNumber}`);
  await expect(page.getByRole("heading", { name: "Friday Access" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Secure QR code/ })).toBeVisible();
  await expect(page.getByText(ticketNumber)).toBeVisible();

  // Capture the live QR token exactly as the member's phone would display it.
  const res = await page.request.get(`/api/tickets/${ticketNumber}/qr`);
  expect(res.ok()).toBe(true);
  const { token } = await res.json();
  expect(token).toMatch(/^CJ1\./);
  qrToken = token;
  expect(res.headers()["cache-control"]).toContain("no-store");
  await writeQrVideo(token);

  await page.goto("/events/abu-dhabi-2026");
  await expect(page.getByRole("tab", { name: /Friday/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Guest arrival" })).toBeVisible();
  await page.getByRole("tab", { name: /Sunday/ }).click();
  await expect(page.getByRole("heading", { name: "Abu Dhabi Grand Prix" })).toBeVisible();

  // Saving an item marks it in red ("Saved" badge, filled red bookmark).
  const save = page.getByRole("button", { name: "Save Abu Dhabi Grand Prix" });
  await save.click();
  const saved = page.getByRole("button", { name: "Remove Abu Dhabi Grand Prix from saved" });
  await expect(saved).toHaveAttribute("aria-pressed", "true");
  await expect(saved).toHaveCSS("background-color", "rgb(239, 35, 60)");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  // …and it is persisted, not just optimistic.
  await page.reload();
  await page.getByRole("tab", { name: /Sunday/ }).click();
  await expect(page.getByRole("button", { name: "Remove Abu Dhabi Grand Prix from saved" })).toBeVisible();

  await page.goto("/concierge/new");
  await page.getByText("Dining", { exact: true }).click();
  await page.getByLabel("Subject").fill("Dinner for two on Saturday");
  await page.getByLabel("Your request").fill("A quiet table at 20:30 if possible.");
  await page.getByRole("button", { name: "Send to concierge" }).click();
  await expect(page.getByText("Request received.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dinner for two on Saturday" })).toBeVisible();
});

test("staff: scan the member's QR code and check them in", async () => {
  const { page, close } = await scannerPage();
  try {
    await expect(page.getByText("Valid", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Alex Carter")).toBeVisible();
    await page.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByText("Checked in", { exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

test("staff: 'Photo of QR' works without live camera access", async ({ browser }) => {
  // A phone opening the scanner over plain http gets no live camera; the photo fallback still works.
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  try {
    await login(page, "scanner@joia.test", STAFF_PW, "/admin/login");
    const png = await QRCode.toBuffer(qrToken, { errorCorrectionLevel: "M", margin: 4, width: 600 });
    await page.locator("#qr-photo").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Alex Carter")).toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
  }
});

test("staff sign-in page refuses member accounts", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Operations sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("alex.carter@joia.test");
  await page.getByLabel("Password").fill(MEMBER_PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("This sign-in is for CLUB JOIA staff", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
  // Unauthenticated visits to the admin portal land on the staff sign-in.
  await page.goto("/admin/events");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("admin: create a new event with an uploaded hero image", async ({ page }) => {
  await login(page, "admin@joia.test", STAFF_PW, "/admin/login");
  await page.goto("/admin/events");
  await page.getByRole("link", { name: "Create new event" }).click();
  await page.getByLabel("Event name").fill("Monaco Grand Prix 2027");
  await page.getByLabel("Venue").fill("Port Hercule");
  await page.getByLabel("City").fill("Monaco");
  await page.getByLabel("Country").fill("Monaco");
  await page.getByLabel("Timezone (IANA)").fill("Europe/Monaco");
  await page.getByLabel("Start date").fill("2027-06-04");
  await page.getByLabel("End date").fill("2027-06-06");
  await page.getByLabel("Ticket number prefix").fill("MC27");
  await page.getByLabel("Hero image").setInputFiles("public/brand/web/CJ300_Logo_clr.png");
  await page.getByLabel("Copy setup from").selectOption({ label: "Abu Dhabi Grand Prix Weekend 2026" });
  await page.getByRole("button", { name: "Create event" }).click();
  await page.waitForURL(/\/admin\/events\/(?!new)[^/]+$/);
  await expect(page.getByRole("heading", { name: "Monaco Grand Prix 2027" })).toBeVisible();
  const hero = page.locator('img[src^="/api/files/event_image/"]');
  await expect(hero).toBeVisible();
  // The uploaded image is served (authorised) from storage.
  const img = await page.request.get((await hero.getAttribute("src"))!);
  expect(img.headers()["content-type"]).toBe("image/png");

  // Programme and tickets are scoped to the new event.
  await page.getByRole("link", { name: "Programme" }).first().click();
  await expect(page.getByRole("heading", { name: "Monaco Grand Prix 2027" })).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByText("Total events")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tickets by type" })).toBeVisible();
});

test("admin: revoke the ticket", async ({ page }) => {
  await login(page, "admin@joia.test", STAFF_PW, "/admin/login");
  await page.goto(`/admin/tickets?q=${ticketNumber}`); // defaults to the current event (Abu Dhabi)
  await page.getByRole("link", { name: ticketNumber }).click();
  await page.getByLabel("Reason").fill("E2E revocation test");
  await page.getByRole("button", { name: "Revoke ticket" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ticket revoked." })).toBeVisible();
});

test("staff: scanning the revoked ticket's QR fails", async () => {
  const { page, close } = await scannerPage();
  try {
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
  } finally {
    await close();
  }
});
