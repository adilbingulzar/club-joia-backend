# CLUB JOIA 300 — Membership & Concierge Platform (V1)

The private members' platform for CLUB JOIA 300, starting with the **Abu Dhabi Grand Prix Weekend, 4–6 December 2026**.

- **Members** (mobile PWA): metal membership card, event programme, tickets with rotating signed QR credentials, concierge requests, notifications and profile.
- **Check-in staff** (`/staff/scanner`): live camera QR scanning, a "Photo of QR" fallback that works on any phone camera, manual ticket lookup, check-in or deny.
- **Admin portal** (`/admin`, staff sign-in at **`/admin/login`**): members, tiers and entitlements, events (create new events, uploaded hero images), programme and tickets per event, access logs, concierge (email / WhatsApp alerts to the responsible staff), notifications, staff, audit log and settings.

Stack: Next.js 16 (App Router, Cache Components), React 19, TypeScript (strict), Tailwind CSS 4, PostgreSQL with Prisma 7, Vitest and Playwright.
Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Roadmap: [`docs/PHASE2.md`](docs/PHASE2.md), [`docs/PHASE3.md`](docs/PHASE3.md).

---

## Quick start (local development)

Requirements: Node.js ≥ 20.19 and npm. **No Docker or system PostgreSQL is needed.** The `embedded-postgres` dev dependency runs real PostgreSQL binaries from `node_modules`.

```bash
npm install                  # also runs `prisma generate`
cp .env.example .env         # then fill AUTH_SECRET, QR_SIGNING_SECRET, CRON_SECRET (see comments)
npm run push:keys            # optional: paste the VAPID keys into .env for web push

npm run db:start             # terminal 1 — local PostgreSQL on :54329 (data in .data/postgres)
npm run db:deploy            # apply migrations
npm run db:seed              # development seed data (see below)
npm run dev                  # terminal 2 — http://localhost:3000
```

To use your own PostgreSQL instead, point `DATABASE_URL` and `TEST_DATABASE_URL` at it and skip `db:start`.

### Development accounts (seed)

⚠️ These passwords are **fake, public and for local development only**. The seed refuses to run when `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`.

| Account | Role | Password |
| --- | --- | --- |
| `alex.carter@joia.test` | Member · Ruby Red | `JoiaDev!2026-member` |
| `sophia.laurent@joia.test` | Member · Pearly White | `JoiaDev!2026-member` |
| `marcus.vale@joia.test` | Member · Ultra Black | `JoiaDev!2026-member` |
| `admin@joia.test` | Super admin | `JoiaDev!2026-staff` |
| `manager@joia.test` | Admin | `JoiaDev!2026-staff` |
| `concierge@joia.test` | Concierge | `JoiaDev!2026-staff` |
| `scanner@joia.test` | Check-in staff | `JoiaDev!2026-staff` |

The seed creates the Abu Dhabi chapter, three tiers, the entitlement catalogue, the event, its access zones (Main, VIP Deck, Parking, After-Race) and five ticket types. It adds a **sample programme** for 4, 5 and 6 December (flagged `isSample`, editable in Admin → Programme), tickets for each member, a sample concierge request and a welcome notification. Tier privileges and ticket windows are also sample configuration.

> Tickets are only valid inside their windows (4–7 Dec 2026). Before then the scanner correctly answers **Not valid yet**. To rehearse check-in, adjust a ticket type's validity in Admin → Events.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop / production build / serve |
| `npm run dev:lan` | Dev server over HTTPS on your network, so a phone can use the scanner camera (see below) |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript (strict) |
| `npm run db:migrate` | Create a migration after a schema change (dev) |
| `npm run db:deploy` | Apply migrations (CI / production) |
| `npm run db:seed` | Development seed (idempotent) |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests (run `npx playwright install chromium` once) |
| `npm run icons` | Regenerate PWA icons from `public/brand/app-icon-source.svg` |
| `npm run brand:logos` | Regenerate the trimmed web logos in `public/brand/web` from the official `CJ300_Logo_*.png` |

### Tests

- **Unit** (`tests/unit`): QR signing and verification, the access decision engine (every scan result), entitlement resolution, membership status rules, RBAC and concierge permissions, timezone maths.
- **Integration** (`tests/integration`): real PostgreSQL, calling the service layer. Covers login and sessions, rate limiting, invitation → activation, ticket display, QR scanning, check-in, single entry, zone entitlements, revocation, credential reissue, membership suspension, concierge privacy, notifications and audit-log immutability.
- **E2E** (`tests/e2e`): member logs in, opens the ticket QR, views the programme, saves an item (red marker, persisted) and submits a concierge request. Staff **scan the real QR through a simulated camera** and check the member in, then decode it again via **Photo of QR** without camera access. The staff sign-in refuses member accounts. An admin creates a new event with an uploaded hero image, then revokes the ticket, and the same QR scans as **Revoked**.
- Also covered: event creation and cloning, event-scoped ticket issuing, programme icons, concierge alert routing by category, assignment alerts, WhatsApp number validation.

Integration and E2E runs each **create their own throwaway database** on the `TEST_DATABASE_URL` server, then migrate, seed and drop it afterwards. They never reset an existing database.

## PWA

- Manifest: `src/app/manifest.ts`. Icons: `public/icons` (placeholder monogram; regenerate with `npm run icons`).
- Service worker: `public/sw.js`. It caches static assets and the public (non-personal) programme, and falls back to `/offline` for navigations. **It never caches QR tokens, files or member data.** QR tokens live only in page memory.
- In development the service worker is opt-in: open any page with `?sw=1` once. In production it always registers.
- iOS: web push requires the app to be **added to the Home Screen** (iOS 16.4+). The UI explains this to members.

## Scanning with a phone

Phones can scan in two ways:

1. **Live camera** (Scan QR). Mobile browsers only open the camera on a **secure (https) page**. In production this is automatic. On a local network use `npm run dev:lan` and open `https://<your-computer-ip>:3000/admin/login` on the phone, accepting the self-signed certificate warning once. A tunnel (e.g. Cloudflare Tunnel, ngrok) also works; add its hostname to `DEV_ALLOWED_ORIGINS`. A torch button appears where the phone supports it.
2. **Photo of QR**: works everywhere, including plain http and browsers without live-camera access. The phone's own camera app takes a photo, and the code is decoded on the device.

## Staff alerts (email / WhatsApp)

- New member concierge requests alert the staff **responsible for that category** (Admin → Staff → Edit → "Responsible for"). Concierge staff with no categories selected receive all categories. If nobody covers a category, admins are alerted.
- Assigning a request alerts the assignee (not when you assign it to yourself).
- Each person chooses email and/or WhatsApp; WhatsApp needs their number in international format.
- Every request shows, in its staff-only internal notes, who was alerted and on which channel, or why an alert wasn't sent.
- Delivery: set `EMAIL_DRIVER=smtp` (with `SMTP_URL`) or `resend`, and `WHATSAPP_DRIVER=twilio`. With the default `console` drivers, alerts are only logged.

## Images

Images are always **uploaded** (JPG, PNG or WebP up to 8 MB, checked by size and file signature), never linked by URL: the event hero image (Admin → Events) and the optional programme item image (Admin → Programme). They are stored privately and served through `/api/files` to signed-in users. Programme items also show a topic icon, chosen automatically from the title or picked by an admin.

## Push notifications

1. `npm run push:keys`, then set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT`.
2. Members enable push in **Profile → Notifications** (or from the notification centre).
3. Admin → Notifications sends to all members, a tier, an event's ticket holders, or one member. In-app delivery always happens; push goes to subscribed devices. Delivery stats are shown per notification.
4. **Scheduled** notifications are delivered by `GET /api/cron/notifications` with `Authorization: Bearer $CRON_SECRET`. Call it every minute from any scheduler. Example for Vercel, in `vercel.json`: `{"crons":[{"path":"/api/cron/notifications","schedule":"* * * * *"}]}` (Vercel sends the `CRON_SECRET` bearer automatically).

System notifications are automatic: ticket issued, concierge reply / confirmed / waiting / completed, and tier change.

## QR architecture (summary)

A QR code contains only `CJ1.<payload>.<HMAC-SHA256>`. The payload is `{ r: credentialRef, n: nonce, e: expiry }`. There is no name, email, phone or database id. Tokens expire after `QR_TOKEN_TTL_SECONDS` (default 5 minutes), and the member's screen refreshes them automatically. Every scan re-checks live state: credential, ticket status, membership, account, validity window, zone, zone entitlement and entry policy. Revoking a ticket or **reissuing its credential** invalidates every circulating QR (including screenshots) immediately. Every attempt is logged. Details: [`docs/ARCHITECTURE.md#qr-security`](docs/ARCHITECTURE.md#qr-security).

## Creating admin accounts

- **First production super admin:** create the user with a one-off SQL insert or a script that sets `role = 'SUPER_ADMIN'`, `status = 'PENDING_ACTIVATION'`. Then generate an activation link from a trusted shell, or temporarily run the seed in a staging copy. The recommended path is to seed staging, then invite the real super admin from Admin → Staff and disable the seeded accounts.
- **Further staff:** Admin → Staff (super admin only). Choose a role, plus WhatsApp number, alert channels and concierge categories. You receive a one-time activation link to share securely while no email provider is configured. Staff sign in at `/admin/login`. Role changes and disabling sign the person out everywhere.
- **Members:** Admin → Members → New member. This creates an invited membership and an activation link. Activation sets the password, records consent to the terms and privacy policy, and activates the membership.

## Deployment

Host-agnostic: any Node.js 20+ host plus managed PostgreSQL.

1. Provision PostgreSQL. Set `DATABASE_URL`; use the pooled URL on serverless.
2. Set every variable from `.env.example` in the host's secret store. Use `NEXT_PUBLIC_APP_URL=https://…`.
3. Build: `npm ci && npm run build`. Release step: `npm run db:deploy`.
4. Storage: set `STORAGE_DRIVER=s3` and the bucket variables. Local disk does not persist on serverless hosts.
5. Configure the cron call for scheduled notifications.
6. Security headers (CSP, HSTS on https, frame denial, Permissions-Policy allowing only the camera) are set in `next.config.ts`.
7. Ensure the host sets `X-Forwarded-For` (Vercel and most proxies do). It is used for per-IP rate limits and audit IPs.
8. Recommended: give the runtime a database role **without** owner rights, so it cannot drop the audit-log trigger.

Vercel works out of the box. On other platforms use `next start` behind TLS.

## Remaining production items

These are **not done in V1** and need decisions or inputs before launch:

- **Final domain** and `NEXT_PUBLIC_APP_URL` (HTTPS).
- **Production database** (managed PostgreSQL, backups and point-in-time recovery) plus a non-owner runtime role.
- **Email provider:** SMTP and Resend drivers are built but not configured (needs an account, a verified sending domain and `SMTP_URL` / `RESEND_API_KEY`). Until then, activation and reset links are handed over manually from the admin UI and staff email alerts are only logged.
- **WhatsApp:** the Twilio driver is built but not configured. It needs a Twilio account, a WhatsApp sender approved by Meta, and an approved message template (`TWILIO_WHATSAPP_CONTENT_SID`). Until then WhatsApp alerts are only logged.
- **Real VAPID keys** and the `CRON_SECRET` scheduler.
- **Object storage bucket** (S3, R2 or Supabase) for photos and attachments.
- **Legal copy:** membership terms and privacy policy (`/legal/terms` and `/legal/privacy` are placeholders), plus the `TERMS_VERSION` constant.
- **Final programme** and times (seeded items are samples), final ticket windows, and confirmed tier privileges.
- **Production admin accounts**, with the seeded `@joia.test` accounts removed.
- **Brand assets:** the official logos (`public/brand/CJ300_Logo_{wht,blk,clr}.png`) are in use. The **app icon** (`app-icon-source.svg` → `npm run icons`) is still a typographic placeholder. The Ultra Black card uses the white logo, since the black one would be invisible on it.
- **Event hero image** (Admin → Events → Hero image).
- **MFA for admin accounts:** the schema is ready, enrolment is not built.
- **Monitoring and error reporting** (e.g. Sentry) and uptime checks.
- **Load test** of scanning for peak arrival.
- **Penetration test** before go-live.
