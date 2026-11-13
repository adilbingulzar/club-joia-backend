# CLUB JOIA 300 — Membership & Concierge Platform (V1)

The private members' platform for CLUB JOIA 300, starting with the **Abu Dhabi Grand Prix Weekend, 4–6 December 2026**.

- **Members** (mobile PWA): metal membership card, event programme, tickets with rotating signed QR credentials, concierge requests, notifications and profile.
- **Check-in staff** (`/staff/scanner`): live camera QR scanning, a "Photo of QR" fallback that works on any phone camera, manual ticket lookup, check-in or deny.
- **Admin portal** (`/admin`, staff sign-in at **`/admin/login`**): members, tiers and entitlements, events (create new events, uploaded hero images), programme and tickets per event, access logs, concierge (email / WhatsApp alerts to the responsible staff), notifications, staff, audit log and settings.

Stack: Next.js 16 (App Router, Cache Components), React 19, TypeScript (strict), Tailwind CSS 4, MySQL 8 with Prisma 7, Vitest and Playwright.
Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Roadmap: [`docs/PHASE2.md`](docs/PHASE2.md), [`docs/PHASE3.md`](docs/PHASE3.md).

---

## Quick start (local development)

Requirements: Node.js ≥ 20.19, npm and **MySQL 8.0.13+** (MariaDB 10.6+ also works).

One-time database setup (as the MySQL root user). The `joia_it_*` / `joia_e2e_*` grants let the tests create and drop their own throwaway databases:

```sql
CREATE DATABASE your_database CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'joia'@'localhost' IDENTIFIED BY 'Choose-a-Password-1';
GRANT ALL PRIVILEGES ON your_database.* TO 'joia'@'localhost';
GRANT ALL PRIVILEGES ON `joia\_it\_%`.*  TO 'joia'@'localhost';
GRANT ALL PRIVILEGES ON `joia\_e2e\_%`.* TO 'joia'@'localhost';
-- Needed only when binary logging is on (the MySQL 8 default) and the user is not SUPER:
-- lets the migration create the audit-log triggers.
SET PERSIST log_bin_trust_function_creators = 1;
```

```bash
npm install                  # also runs `prisma generate`
cp .env.example .env         # then fill DATABASE_URL, AUTH_SECRET, QR_SIGNING_SECRET (see comments)
npm run push:keys            # optional: paste the VAPID keys into .env for web push

npm run db:deploy            # apply migrations
npm run db:seed              # development seed data (see below)
npm run dev                  # http://localhost:3000
```

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
| `npm run db:migration:new -- <name>` | Create a migration after a schema change: writes the SQL file only, never touches or resets the database. Tables the project does not manage are left out. |
| `npm run db:deploy` | Apply migrations (CI / production) |
| `npm run db:seed` | Development seed (idempotent) |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Playwright end-to-end tests (run `npx playwright install chromium` once) |
| `npm run icons` | Regenerate PWA icons from `public/brand/app-icon-source.svg` |
| `npm run brand:logos` | Regenerate the trimmed web logos in `public/brand/web` from the official `CJ300_Logo_*.png` |

### Tests

- **Unit** (`tests/unit`): QR signing and verification, the access decision engine (every scan result), entitlement resolution, membership status rules, RBAC and concierge permissions, timezone maths.
- **Integration** (`tests/integration`): real MySQL, calling the service layer. Covers login and sessions, rate limiting, invitation → activation, ticket display, QR scanning, check-in, single entry, zone entitlements, revocation, credential reissue, membership suspension, concierge privacy, notifications and audit-log immutability.
- **E2E** (`tests/e2e`): member logs in, opens the ticket QR, views the programme, saves an item (red marker, persisted) and submits a concierge request. Staff **scan the real QR through a simulated camera** and check the member in, then decode it again via **Photo of QR** without camera access. The staff sign-in refuses member accounts. An admin creates a new event with an uploaded hero image, then revokes the ticket, and the same QR scans as **Revoked**.
- Also covered: event creation and cloning, event-scoped ticket issuing, programme icons, concierge alert routing by category, assignment alerts, WhatsApp number validation.

Integration and E2E runs each **create their own throwaway database** (`joia_it_*` / `joia_e2e_*`) on the `DATABASE_URL` server, then migrate, seed and drop it afterwards. They never reset an existing database.

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

## Website sales (Admin > Sales)

Admins (ADMIN, SUPER_ADMIN) see the website's ticket sales at `/admin/sales`: revenue, paid orders, tickets, average order, charts by day, ticket, tier, status, country and admission, filters (period, status, tier, ticket, country, search), the order list and each order (buyer, IFZA payment, member and tickets issued), plus a CSV export. **Pre-registrations** (`/admin/sales/registrations`) has the website's pre-registration form entries with search and CSV. Read only. It reads club-joia-300-next's `shop_orders` and `pre_registrations` in the same database (`src/services/sales.service.ts`). Optional settings: `SHOP_TIMEZONE` (default `Asia/Dubai`) and `SHOP_CURRENCY` (default `AED`), the same values as the website.

## QR architecture (summary)

A QR code contains only `CJ1.<payload>.<HMAC-SHA256>`. The payload is `{ r: credentialRef, n: nonce, e: expiry }`. There is no name, email, phone or database id. Tokens expire after `QR_TOKEN_TTL_SECONDS` (default 5 minutes), and the member's screen refreshes them automatically. Every scan re-checks live state: credential, ticket status, membership, account, validity window, zone, zone entitlement and entry policy. Revoking a ticket or **reissuing its credential** invalidates every circulating QR (including screenshots) immediately. Every attempt is logged. Details: [`docs/ARCHITECTURE.md#qr-security`](docs/ARCHITECTURE.md#qr-security).

## Creating admin accounts

- **First production super admin:** on the server, run `npm run admin:create -- you@example.com "Your Name"`. It creates (or resets) an active super admin and prints a one-time random password. Then invite everyone else from the admin.
- **Further staff:** Admin → Staff (super admin only). Choose a role, plus WhatsApp number, alert channels and concierge categories. You receive a one-time activation link to share securely while no email provider is configured. Staff sign in at `/admin/login`. Role changes and disabling sign the person out everywhere.
- **Two-factor sign-in:** admins and super admins also enter a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …). At their first sign-in they scan a QR code. Lost phone: Admin → Staff → Two-factor → Reset, or `npm run admin:create -- <email>` for a super admin. Needs `MFA_ENCRYPTION_KEY` (same value in club-joia-300-next). Details: [`docs/ARCHITECTURE.md#mfa`](docs/ARCHITECTURE.md#mfa).
- **Members:** Admin → Members → New member. This creates an invited membership and an activation link. Activation sets the password, records consent to the terms and privacy policy, and activates the membership.

## Deployment

Any Linux server with Node.js 20.19+ (22 LTS recommended) and MySQL 8, with the app (`next start`) behind an HTTPS reverse proxy such as Nginx.

1. Set every variable from `.env.example` in the server's `.env`. Use `NEXT_PUBLIC_APP_URL=https://…` (also read at build time, so rebuild after changing it). Remove optional secrets you don't use instead of leaving them empty.
2. Build and migrate: `npm ci --include=dev && npm run build && npm run db:deploy`, then restart the app. `--include=dev` matters when `NODE_ENV=production` is set, because the build needs dev dependencies.
3. **Migration user and triggers:** the init migration creates the audit-log triggers. With binary logging on (the MySQL 8 default), MySQL only allows that for a user with SUPER, or after `SET PERSIST log_bin_trust_function_creators = 1;`. MySQL DDL is not transactional: if a migration fails part-way, fix the database, then run `npx prisma migrate resolve`.
4. **No destructive Prisma commands:** `prisma.config.ts` refuses `migrate reset`, `migrate dev`, `db push` and `db execute`, whatever the database user, so the Prisma CLI cannot wipe or drop data. Application code is not affected. Migrations still run with `npm run db:deploy`, and the seed with `npm run db:seed`. MySQL triggers cannot block `TRUNCATE`, so in production the app's database user should not hold DROP.
5. **IP allowlist (optional):** `IP_ALLOWLIST` (addresses and CIDR ranges) closes the whole app, every page, API and file, to any other address (403). It reads the last `X-Forwarded-For` entry, so `next start` must listen on 127.0.0.1 only (`next start -H 127.0.0.1`), behind nginx. Members outside the list are locked out too.
   **Client IP:** the app takes the last `X-Forwarded-For` entry as the client IP (rate limits, audit log), the same as the allowlist, so either Nginx `proxy_set_header X-Forwarded-For $remote_addr;` or `$proxy_add_x_forwarded_for` works, as long as the app is only reachable through the proxy. Also set `client_max_body_size 12m;` for uploads.
6. **Uploads:** with `STORAGE_DRIVER=local`, set `STORAGE_LOCAL_DIR` to an absolute path outside the app folder so deployments never remove it, and back it up with the database.
7. **Scheduled notifications:** call `GET /api/cron/notifications` every minute with `Authorization: Bearer $CRON_SECRET`, e.g. `curl -fsS -H "Authorization: Bearer …" http://127.0.0.1:3000/api/cron/notifications`.
8. First admin: `npm run admin:create -- you@example.com "Your Name"` (see above). Never run `npm run db:seed` in production.

Security headers (CSP, HSTS on https, frame denial, Permissions-Policy allowing only the camera) are set in `next.config.ts`.

## Remaining production items

These are **not done in V1** and need decisions or inputs before launch:

- **Final domain** and `NEXT_PUBLIC_APP_URL` (HTTPS).
- **Production database:** MySQL 8 with backups, and a runtime user without DROP/ALTER/TRIGGER rights (see Deployment).
- **Email provider:** SMTP and Resend drivers are built but not configured (needs an account, a verified sending domain and `SMTP_URL` / `RESEND_API_KEY`). Until then, activation and reset links are handed over manually from the admin UI and staff email alerts are only logged.
- **WhatsApp:** the Twilio driver is built but not configured. It needs a Twilio account, a WhatsApp sender approved by Meta, and an approved message template (`TWILIO_WHATSAPP_CONTENT_SID`). Until then WhatsApp alerts are only logged.
- **Real VAPID keys** and the `CRON_SECRET` scheduler.
- **Object storage bucket** (S3, R2 or Supabase) for photos and attachments.
- **Legal copy:** membership terms and privacy policy (`/legal/terms` and `/legal/privacy` are placeholders), plus the `TERMS_VERSION` constant.
- **Final programme** and times (seeded items are samples), final ticket windows, and confirmed tier privileges.
- **Production admin accounts**, with the seeded `@joia.test` accounts removed.
- **Brand assets:** the official logos (`public/brand/CJ300_Logo_{wht,blk,clr}.png`) are in use. The **app icon** (`app-icon-source.svg` → `npm run icons`) is still a typographic placeholder. The Ultra Black card uses the white logo, since the black one would be invisible on it.
- **Event hero image** (Admin → Events → Hero image).
- **Monitoring and error reporting** (e.g. Sentry) and uptime checks.
- **Load test** of scanning for peak arrival.
- **Penetration test** before go-live.
