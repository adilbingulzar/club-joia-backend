# Phase 3 — Global Club

Goal: CLUB JOIA 300 becomes a travelling, year-round members club, with chapters in Monaco, Miami, Singapore and beyond, annual memberships, partner privileges, an AI concierge and travel integrations.

Flags: `FEATURE_GLOBAL_CHAPTERS`, `FEATURE_PARTNER_BENEFITS`, `FEATURE_AI_CONCIERGE`.

## 1. Global chapters & international events

Already in place in V1:
- `chapters` (slug, city, country, timezone) with `events.chapter_id`.
- Events are timezone-aware, and programme times are local wall clock per event.
- Access zones and ticket types are per event.

To add:
- ~~Admin "New event" flow~~ — **done** (Admin → Events → Create new event; optionally copies zones, ticket types with shifted windows, and the programme as drafts from an existing event).
- Chapter-scoped staff: `staff_chapter_assignments (user_id, chapter_id, role)`, so Monaco staff only operate Monaco. `requirePermission` gains an optional scope argument.
- Member app: an events list across chapters (already a list in V1), filters by chapter, and a "home chapter" on the card (already printed on the card back).
- Localisation: `next-intl` (or equivalent), with currency and date formats per chapter.

## 2. Annual / global memberships

- `memberships.kind = ANNUAL` exists today. Annual memberships span many events: tickets can be auto-issued per event from entitlements (`event_access` + a new `annual_events_included` integer).
- `global_memberships` (optional, if contracts/billing need it): `id, member_id, plan, term_start, term_end, renewal, billing_ref`.
- Renewal workflow: `EXPIRED → ACTIVE` is an allowed transition in V1. Add scheduled reminders through `NotificationService` and the cron route.
- Payments: a payment gateway (Stripe or a regional PSP) behind a `PaymentService` adapter. Card data never touches our servers.

## 3. Partner benefits & offers

```
partner_benefits (id, partner_id, code, name, description, terms, chapter_id?, active)
partner_offers   (id, partner_id, title, valid_from, valid_until, eligibility (entitlement codes), redemption_method)
concierge_partners (id, name, category HOTEL|RESTAURANT|AVIATION|YACHT|TRANSPORT|NIGHTLIFE, chapter_id, contacts, api_config_ref)
```

- Eligibility reuses the entitlement engine: offers declare entitlement codes, and `hasEntitlement()` decides.
- Redemption QR codes reuse the signed-token pattern with a different prefix (e.g. `CJO1`).

## 4. AI concierge

- Works through `ConciergeService`, the same functions members and staff use. The AI acts as an `Actor` with a dedicated role (`AI_CONCIERGE`) whose permissions are a strict subset: read the member's own context, create requests (`source = AI_AGENT`), post messages (`sender_type = AI_AGENT`), propose status changes for human approval.
- `ai_concierge_sessions (id, member_id, started_at, ended_at, model, transcript_ref, request_ids[])` for traceability. Every AI action is audited like a staff action.
- Guardrails: no access to internal notes unless explicitly granted, no bookings without member confirmation, and handoff to human concierge on low confidence or by request.
- Model choice: current Claude models through the Anthropic API (tool use over the service layer).

## 5. Travel, hotel, restaurant & aviation integrations

```
travel_bookings     (id, member_id, concierge_request_id, provider, reference, status, details JSON)
hotel_bookings      (id, member_id, concierge_request_id, partner_id, check_in, check_out, room, status, provider_ref)
restaurant_bookings (id, member_id, concierge_request_id, partner_id, starts_at, covers, status, provider_ref)
aviation_requests   (id, member_id, concierge_request_id, from, to, depart_at, pax, aircraft_pref, status, operator_ref)
```

- Every booking hangs off a `concierge_request`, so the member's single view of "what concierge did for me" stays unified.
- Provider integrations are adapters (as with notification channels) behind `BookingService`. Webhooks come in through authenticated route handlers and update booking status and notify the member.
- Confirmed bookings feed the Phase 2 calendar (`calendar_events.source = CONCIERGE`).

## 6. International expansion checklist

- Data residency per region (EU members → EU database region), DPA with processors, cross-border transfer documentation.
- Additional channels activated: SMS/WhatsApp to **members** (staff email/WhatsApp alerts already exist: `StaffAlertService`) (e.g. Twilio / Meta Cloud API), native push (APNs/FCM) for future native apps.
- Apple / Google Wallet passes for the membership card (the card already uses non-sensitive data only and a stable membership number).
- MFA enforced for all staff. Chapter-scoped admin roles.
- Operational: multi-event dashboard, scanner offline mode (signed allow-lists or TOTP-style credentials as described in ARCHITECTURE §6).
