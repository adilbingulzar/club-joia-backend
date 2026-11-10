# Phase 2 — Member Network

Goal: let members connect privately, meet during events, and receive introductions, without compromising the discretion of a private club. **Nothing is public by default.**

Flags: `FEATURE_MEMBER_NETWORK`, `FEATURE_MEETING_SCHEDULER`.

## 1. Shared member profiles (opt-in)

- Uses the dormant fields already on `members`: `networking_profile_enabled` (default false), `networking_interests[]`, `looking_to_meet[]`, `linkedin_url`, `investment_interests[]`, `social_links`, and `public_profile_fields[]`, a whitelist of which fields other members may see.
- New `MemberNetworkService.getVisibleProfile(viewer, memberId)` returns only whitelisted fields, and only when **both** members have networking enabled. A consent record (`ConsentType` + `NETWORK_PROFILE`) is written whenever visibility changes.
- UI: the "Member Network — Coming soon" section in Profile becomes the settings page. A member directory is browsable by event attendance, interests and tier, with search limited to opted-in members.

## 2. Connections & introductions

```
member_connections (id, requester_id → members, addressee_id → members, status PENDING|ACCEPTED|DECLINED|BLOCKED, created_at, responded_at)
introductions      (id, member_a_id, member_b_id, introduced_by → users (concierge), note, status, created_at)
```

- Concierge-curated introductions are a premium differentiator. They are a concierge staff action, audited, and notify both members.
- Blocking is respected everywhere (directory, messaging, scheduling).

## 3. Messaging

```
direct_messages (id, conversation_id, sender_id → members, body, created_at, read_at, deleted_at)
conversations   (id, kind DIRECT|GROUP, created_at) + conversation_members
```

- Only between accepted connections. Uses the existing storage abstraction for attachments.
- New notification type for messages, delivered through the existing `NotificationService` channels.
- Moderation: concierge can view reported conversations only (a new permission `network:moderate`). Messages are not visible to staff by default.

## 4. Meeting scheduling & availability

```
member_availability (id, member_id, event_id, starts_at, ends_at, note)
meeting_requests    (id, event_id, requester_id, invitee_id, proposed_start, proposed_end, location, status, message)
calendar_events     (id, member_id, source PROGRAMME|MEETING|CONCIERGE|EXTERNAL, ref_id, starts_at, ends_at, title)
```

- `member_program_favorites` (V1) seeds each member's personal calendar. Programme items already resolve to absolute instants in the event timezone (`ProgrammeService.toView`).
- Concierge confirmations (e.g. dinner bookings) appear as `calendar_events` with `source = CONCIERGE`.

## 5. Calendar sync

- Personal ICS feed per member (`/api/calendar/<signed-token>.ics`), with a revocable signed token. Works with Apple Calendar, Google and Outlook without OAuth.
- Optional later: Google / Microsoft OAuth two-way sync (stored in `auth_identities` and a token vault).

## 6. Security & privacy checklist for Phase 2

- New permissions in `ROLE_PERMISSIONS`: `network:view`, `network:connect`, `network:message`, `network:moderate`.
- All visibility decisions live in pure `src/domain/network.ts` functions with unit tests (as V1 does for access and concierge).
- Data export (`exportMyData`) and anonymisation (`anonymizeMember`) are extended to the new tables.
- Rate limits on connection requests and messages.
