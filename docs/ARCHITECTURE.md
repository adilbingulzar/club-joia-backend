# CLUB JOIA 300 — Architecture

## 1. Shape of the system

```
Browser (member PWA · scanner · admin)
   │  Server Components render data  ·  Server Actions mutate  ·  a few Route Handlers (QR, files, export, cron)
   ▼
src/lib/auth/dal.ts  ── cookie → session → Actor { userId, role, memberId, ip, ua }
   ▼
src/services/*.service.ts  ── ALL business rules + permission checks + audit
   │        uses
   ├── src/domain/*        pure decision logic (access engine, entitlements, membership, concierge rules)
   ├── src/lib/qr/token.ts pure QR signing/verification
   └── src/lib/db.ts       Prisma client (MySQL, via src/lib/db-adapter.ts)
```

- **Services never read cookies or headers.** They receive an `Actor`. The same functions can be called by pages, actions, cron jobs, tests and (in Phase 3) the AI concierge agent or a native app.
- **Every service function checks its own permission** (`requirePermission`), even when the calling page has already checked it. UI hiding is cosmetic only.
- React components contain no business rules. They format data that services return.

### Directory map

| Path | Contents |
| --- | --- |
| `src/app/(auth)` | login, activation, password reset |
| `src/app/(member)` | member PWA: home, events, card, tickets, concierge, notifications, profile |
| `src/app/staff` | check-in scanner |
| `src/app/admin` | admin portal |
| `src/app/api` | QR token, files, data export, public programme, cron |
| `src/services` | AuthService, MemberService, MembershipService, EntitlementService, EventService, ProgrammeService, TicketService, QRService, ConciergeService, NotificationService (+ channel adapters), AuditService, StorageService, EmailService, StaffService, SettingsService, DashboardService |
| `src/domain` | pure rules (unit tested) |
| `src/components/joia` | brand component library (JoiaLogo, MetalMembershipCard, EventHero, ProgrammeTimeline/Card, TicketCard, QRCodeDisplay, StatusBadge, TierBadge, PermissionBadge, MemberAvatar, ConciergeRequestCard, NotificationCard, ConfirmDialog, EmptyState, LoadingSkeleton) |
| `src/components/admin` | AdminDataTable, filters, action controls |
| `src/styles/design-tokens.ts` | canonical design tokens (mirrored in `globals.css`) |
| `src/validators` | zod input schemas |
| `prisma/` | schema, migrations, seed |

### Rendering model

Next.js 16 **Cache Components** is enabled. Layouts are static shells (brand chrome, navigation). Anything that reads the session sits inside `<Suspense>` and streams in with a skeleton loader. Personal data is never put into a shared cache.

## 2. User roles

| Role | Can | Cannot |
| --- | --- | --- |
| MEMBER | own profile, membership, card, tickets/QR, programme, concierge, notifications | anything about other members; admin; tiers; tickets |
| CHECK_IN_STAFF | scanner: validate, check in, deny; sees **name, photo, tier, number, access** only | browse members, contact details, concierge notes |
| CONCIERGE | all concierge requests, status, assignment, internal notes, messages; basic member info (contact and dietary) | tickets, tiers, roles, settings |
| ADMIN | everything above + members, memberships, tiers/entitlements, programme, tickets, scans, notifications, dashboard, audit | staff roles, system settings, event configuration |
| SUPER_ADMIN | everything + staff and roles, settings, event configuration (dates, zones, ticket types) | — |

Defined once in `src/lib/auth/permissions.ts` (`ROLE_PERMISSIONS`) and unit tested.

## 3. Authentication & sessions

- Email and password with **Argon2id**.
- Login creates a random 256-bit session token in an `httpOnly`, `SameSite=Lax` cookie. In production it is `Secure`, with the `__Host-` prefix. Only `HMAC(AUTH_SECRET, token)` is stored in `sessions`.
- Member sessions last 30 days and staff sessions 12 hours. Disabling an account, changing a role, resetting a password or choosing "sign out everywhere" revokes sessions.
- Activation and reset links are single-use (atomic claim), expire (72 h / 60 min) and are stored hashed.
- Sign-in gives one generic answer for unknown, invited and wrong-password cases, so membership is not disclosed. Rate limits apply per IP and per email (DB-backed, shared across instances). Accounts lock for 15 minutes after 8 failures.
- **CSRF:** Server Actions are origin-checked by Next.js. Route handlers are GET-only, or authorised by a bearer secret (cron).
- `proxy.ts` only redirects cookie-less visitors to `/login`. Real authorisation is in the DAL and the services.

### MFA

The schema has `mfaEnabled`, `mfaSecretEncrypted` and `mfaEnrolledAt` on users, plus `mfaVerified` on sessions. `mfaRecommended(role)` marks ADMIN and SUPER_ADMIN. Planned work: TOTP enrolment, a verification step that sets `session.mfaVerified`, and a `requirePermission` check that rejects admin permissions on non-MFA sessions once enforcement is on.

### Future sign-in methods

`auth_identities` (provider + providerAccountId) and `AuthTokenType.MAGIC_LINK` exist for Apple, Google, passkeys and magic links. Each new method only has to resolve a user and call `createSession()`.

## 4. Database

MySQL 8.0.13+ (MariaDB 10.6+ also works) via Prisma migrations (`prisma/migrations`) and the `@prisma/adapter-mariadb` driver adapter. Every model is commented in `prisma/schema.prisma`.

MySQL-specific conventions:

- **UTC everywhere.** `src/lib/db-adapter.ts` pins every connection to `time_zone = '+00:00'`. Prisma reads and writes `DATETIME(3)` values as UTC, and column defaults (`CURRENT_TIMESTAMP(3)`) and raw SQL use the session zone, so this keeps them consistent whatever the server's clock is set to. Raw SQL uses `UTC_TIMESTAMP(3)` explicitly.
- **Lists are JSON arrays** (`users.concierge_categories`, `notifications.channels` and the dormant networking lists on `members`). MySQL has no array columns. Services read them through `src/lib/json-list.ts`, which returns typed arrays. JSON defaults (`[]`, `{}`) are applied by Prisma Client, not by MySQL, so raw `INSERT`s must supply them.
- **Text sizes.** Prisma maps `String` to `VARCHAR(191)` on MySQL. Free text is `@db.Text`, and anything that can be longer than 191 characters (emails up to 254, user agents, push endpoints) has an explicit `@db.VarChar(n)`.
- **Case-insensitive search** comes from the `utf8mb4_unicode_ci` collation, so queries use a plain `contains` (Prisma's `mode: "insensitive"` is PostgreSQL-only).
- **DDL is not transactional in MySQL.** A migration that fails part-way leaves the statements before it applied. Fix the database by hand, then `prisma migrate resolve`.

- **Identity:** `users`, `sessions`, `auth_tokens`, `auth_identities`, `rate_limit_buckets`, `consent_records`.
- **Members:** `members` (profile + dormant Phase 2 networking fields), `chapters`, `membership_tiers`, `memberships` (status, dates, home chapter, `kind` EVENT/ANNUAL), `entitlements`, `tier_entitlements`, `member_entitlements` (overrides).
- **Events:** `events` (global, timezone-aware), `access_zones`, `event_program_items`, `member_program_favorites`.
- **Access:** `ticket_types`, `ticket_type_zones`, `tickets`, `ticket_credentials`, `ticket_check_ins`, `ticket_scan_logs`.
- **Service:** `concierge_requests`, `concierge_request_messages` (with `internal_note`, `sender_type` including `AI_AGENT`).
- **Comms:** `notifications`, `notification_recipients` (per channel), `push_subscriptions`.
- **Ops:** `stored_files`, `system_settings`, `audit_logs` (append-only).

Conventions: opaque CUID primary keys, separate human references (membership number, ticket number, request reference), `metadata` JSON only for non-queried extras, `onDelete: Restrict` on records that must never disappear (members are anonymised, not deleted).

### Entitlement engine

Privileges are rows, not code. A member's effective entitlements are:

1. the grants of the tier on their **current ACTIVE** membership,
2. overlaid with unexpired per-member overrides (grant or revoke).

`hasEntitlement()` gates access zones (`access_zones.required_entitlement_code`), restricted programme items and the "priority" flag on the scanner. The card's privilege list is rendered from the same data. Admins edit the tier matrix in Admin → Memberships.

### Programme times

Stored as event-local wall clock (`date` + `"HH:mm"`) in the event's IANA timezone. Admins type exactly what members see. Conversion to instants happens only in `src/lib/time.ts`. Items ending before they start (22:00–02:00) are treated as running past midnight.

## 5. Ticket system

- A **ticket** = (member, ticket type, validity window). A ticket type covers one or more **access zones** and has an **entry policy**:
  - `SINGLE_ENTRY`: once per zone. The ticket becomes `USED` when all its zones are consumed.
  - `DAILY_ENTRY`: once per zone per event-local day.
  - `MULTI_ENTRY`: re-entry allowed within the window.
- **Ticket-level access** (the type covers the zone) and **membership-level entitlements** (the zone requires an entitlement) are combined. For example, Friday Access covers the VIP Deck zone, but only tiers with `vip_deck_access` get in.
- Duplicate admissions are prevented by the database: `ticket_check_ins` is unique on `(ticket, zone, entry_key)`. The key is `once`, `day:YYYY-MM-DD`, or random for multi-entry, so two scanners racing cannot both admit a single-entry ticket.
- Admin actions: issue (single or bulk by tier), revoke (permanent), suspend/unsuspend, **reissue credential**. Every action is audited.

## <a id="qr-security"></a>6. QR security

```
token = "CJ1." + b64url(JSON{ r: credentialRef, n: nonce, e: expiry }) + "." + b64url(HMAC-SHA256(QR_SIGNING_SECRET, "CJ1."+payload))
```

- `credentialRef` is 128 random bits from `ticket_credentials`, not a ticket or member id. No personal data is in the code.
- Tokens are short-lived (`QR_TOKEN_TTL_SECONDS`, default 300 s, with 15 s skew allowance). The member page fetches a fresh token at ~60% of the TTL, on screen wake, and on demand. Responses are `no-store`, and the service worker never caches them.
- **Verification order:** signature (constant-time, checked before parsing) → expiry → credential exists → credential revoked/superseded → ticket revoked → ticket suspended → account disabled → membership active → validity window → zone open → zone on ticket → zone entitlement → entry policy. The result is one of VALID, ALREADY_USED, NOT_VALID_YET, EXPIRED, REVOKED, INVALID, WRONG_ACCESS_ZONE or SUSPENDED, with a reason code. The scanner colour comes from the result: green, amber or red. An expired-but-genuine code is amber with "ask the member to refresh".
- **Check-in** is a second step. It references the logged VALIDATE scan (same staff member, within 3 minutes), re-checks the exact credential that was scanned, and re-evaluates inside a transaction.
- **Revocation** is immediate: revoking a ticket revokes its credentials. **Reissue** mints a new credential version and supersedes the old one, so screenshots and forwarded codes die instantly.
- **Key rotation:** set `QR_SIGNING_SECRET_PREVIOUS` to the old key for one TTL, and verification accepts both.
- Every attempt is logged in `ticket_scan_logs` (staff, device, zone, method QR/MANUAL, result, reason), including forged and unknown codes.
- **Rotating/dynamic credentials:** the TTL is already short and server-driven. For offline-capable rotation later, a TOTP-style variant could derive `n` from a per-credential secret and time step, so a device can rotate codes without network. The `CJ` prefix version (`CJ1`) allows a new format to coexist.
- Manual lookup by ticket number is supported (accessibility, damaged screens). It skips the signature step and is flagged `MANUAL` in the logs.

## 7. Notification system

`NotificationService` creates a `notification` (audience: all members, a tier, an event's ticket holders, or one member; optional schedule). `dispatchNotification()` claims it atomically, resolves the audience, writes an `IN_APP` recipient row per member, then hands each other channel to its **adapter** (`src/services/notifications/channels.ts`):

- `WEB_PUSH`: implemented (VAPID via `web-push`). Expired subscriptions (404/410) are disabled automatically, and the member's push preference is respected.
- `EMAIL`, `SMS`, `WHATSAPP`, `APPLE_PUSH`, `ANDROID_PUSH`: adapters exist and report "not implemented in V1". Recipients are recorded as `SKIPPED`, never faked as sent.

Scheduled notifications are processed by `/api/cron/notifications`. System events (ticket issued, concierge updates, tier change) call `notifyMember()`.

**Staff alerts** are separate from member notifications. `StaffAlertService` (`src/services/staff-alert.service.ts`) emails and/or WhatsApps staff, according to each person's preferences on `users` (`alert_by_email`, `alert_by_whatsapp`, `whatsapp_number`, `concierge_categories`):

- **New concierge request** → recipients from the pure rule `selectNewRequestRecipients()` (`src/domain/concierge.ts`): category owners plus concierge generalists, escalating to admins when nobody covers the category.
- **Assignment** → the assignee, unless they assigned themselves.
- Transports: `EmailService` (`console` | `smtp` via nodemailer | `resend`) and `WhatsAppService` (`console` | `twilio`, using an approved template when `TWILIO_WHATSAPP_CONTENT_SID` is set).
- Alerts run after the response (`next/server` `after()`), so a slow provider never delays the member. They are best-effort, with minimal content (reference, category, subject, link; no member personal data). The outcome is written as a staff-only internal note on the request.

**Images** are uploaded through `StorageService` (size and magic-byte checks) and stored as keys in `events.hero_image` and `event_program_items.image`. `storedImageUrl()` maps a key to `/api/files/…`, and external URLs are never rendered. Programme icons are keys from `src/domain/programme-icons.ts` (`event_program_items.icon`), or chosen automatically from the title or category.

**Staff sign-in** is `/admin/login`: the same session system, but member accounts are refused there. Unauthenticated `/admin/*` and `/staff/*` requests redirect to it. The admin pages live in the `src/app/admin/(portal)` route group, so the sign-in page sits outside the admin layout.

## 8. Privacy & security

- Server-side authorisation everywhere. Zod validation on every input. Prisma parameterisation, plus two raw queries (rate limiter, next membership number) using tagged parameters.
- Uploads are checked by magic bytes and size (no SVG), stored under random keys, and served only through `/api/files/*` after an ownership/role check, with a sandboxed CSP.
- Security headers: CSP (`frame-ancestors 'none'`, own-origin only), HSTS on HTTPS, `nosniff`, `Referrer-Policy: no-referrer`, and a Permissions-Policy allowing only the camera.
- **GDPR:** consent records (terms, privacy, marketing, push), JSON data export, member-initiated deletion request, and admin **anonymisation**. Anonymisation erases PII but keeps tickets, scans and audit rows against an anonymous record.
- Audit log: `audit_logs` is protected by MySQL triggers that reject UPDATE and DELETE. MySQL triggers cannot stop `TRUNCATE` (which needs the DROP privilege), so the production runtime user must not hold DROP, ALTER or TRIGGER (see Deployment in the README). Secrets are redacted from snapshots.
- Errors: users see polite messages. Unexpected errors carry a reference (`ERR-…`, or the Next.js digest), and admin error pages show it for diagnosis. Stack traces never reach the client.

## 9. Future phases — how the foundation anticipates them

Feature flags: `FEATURE_MEMBER_NETWORK`, `FEATURE_MEETING_SCHEDULER`, `FEATURE_GLOBAL_CHAPTERS`, `FEATURE_PARTNER_BENEFITS`, `FEATURE_AI_CONCIERGE` (`src/lib/config/features.ts`). All are off.

**Phase 2** ([PHASE2.md](PHASE2.md)): dormant profile fields already exist (`networking_profile_enabled` defaults to false, `public_profile_fields` defaults to empty). Favourites are the seed of the personal calendar. New tables (`member_connections`, `meeting_requests`, `member_availability`, `calendar_events`, `direct_messages`, `introductions`) reference `members.id` and `events.id` without changing existing tables.

**Phase 3** ([PHASE3.md](PHASE3.md)): `chapters` and `events.chapter_id` already make events multi-city. `memberships.kind = ANNUAL` and `home_chapter_id` cover global memberships. The entitlement catalogue absorbs partner benefits. `concierge_requests.source` and `messages.sender_type = AI_AGENT` let an AI agent work through `ConciergeService` under the same permissions and audit. Booking tables (`travel_bookings`, `hotel_bookings`, `restaurant_bookings`, `aviation_requests`, `concierge_partners`, `partner_offers`, `partner_benefits`, `global_memberships`, `ai_concierge_sessions`) attach to `concierge_requests.id` and `members.id`.

No Phase 2/3 tables are created in V1. That is deliberate: they are additive, so nothing in the V1 schema has to be restructured.
