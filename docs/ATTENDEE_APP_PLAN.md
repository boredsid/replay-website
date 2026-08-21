# REPLAY attendee app plan

## Product goal

Build `app.replaycon.in` as the quickest trustworthy answer to an attendee's
event-day questions: what is happening now, where should I go, what did I save,
and how do I get help? Public utility must work without an account and remain
useful on an unreliable venue network. Personal and circulation features must
be secure, auditable, and deliberately introduced only after their organiser
workflows exist.

This plan expands Track 3 of `docs/LIVE_EVENT_READINESS.md`. That readiness doc
remains the launch decision record; this document defines the app delivery
sequence and feature boundaries.

## Product principles

1. **Useful before sign-in.** The current event, schedule, map status, and
   essential guidance are public.
2. **Offline by design.** The most recent event payload and app shell remain
   usable when venue connectivity drops.
3. **No invented certainty.** Unconfirmed venue, map, support, and policy details
   are clearly marked pending rather than replaced with guesses.
4. **Local unless sync earns its risk.** “My Day” stays on the attendee's device
   until an approved identity/privacy design justifies server sync.
5. **Personal data never enters public payloads.** Tickets, check-in, and loans
   require a separate authenticated contract and audited organiser operations.
6. **Event-day actions need fallbacks.** Check-in and circulation ship only with
   printable/offline procedures and reconciliation ownership.

## Feature plan

### Phase 1 — public utility PWA

This is the first implementation slice.

- **Now:** current event state, daily opening hours, sessions happening now,
  what starts next, and a visible offline/stale-data state.
- **Schedule:** filter by day, activity category, and location; search titles,
  hosts, and descriptions; show cancelled items without presenting them as live.
- **My Day:** save or remove programme items on the current device, with no
  account and no server-side behavioural profile.
- **Map:** show the confirmed venue and external map link when available; clearly
  state that the floor plan is pending until organisers publish one.
- **Event info:** date, hours, ticket-desk identity guidance, help email, venue
  status, and links to the canonical Plan Your Visit page.
- **Install/offline:** web-app manifest, install affordance, cached shell and
  assets, and network-first caching of the last successful event payload.

### Phase 2 — organiser-controlled live operations

Required before personal attendee functionality.

- **Implemented in the repository:** announcement publishing for normal
  updates, urgent notices, and incident banners, with IST start/end times,
  severity, audience, draft/published state, and audit history. Active notices
  are part of the offline-cacheable attendee bootstrap payload.
- Venue-map publishing with accessible text alternatives, help desk,
  food/water, accessibility points, exits, and an offline-safe asset.
- Per-day check-in, re-entry, undo, staff attribution, search by secure QR token,
  and an offline roster/reconciliation process.
- App surfaces announcements and venue maps only after those admin workflows
  and their failure modes are tested.

### Phase 3 — secure attendee ticket

Identity remains a product and privacy decision, not an implementation detail.
The current registration model is phone-first and some historical users have no
email, so email magic links cannot silently become the only recovery route.

Before building this phase, approve:

- the primary identity flow (email magic link, one-time code, or another
  explicitly supported method);
- recovery for attendees without a usable email address;
- opaque QR-token format, rotation/revocation, screenshot-sharing policy, and
  what scanners reveal;
- session lifetime, rate limits, audit retention, support ownership, and
  privacy/data-use copy.

Launch features are personal ticket status, opaque QR pass, per-day check-in
state, and confirmation recovery. Public API responses must never contain names,
phone numbers, email addresses, registration IDs, payment data, or QR secrets.

### Phase 4 — game-library circulation

Decide first whether REPLAY imports an existing BGC catalogue or owns a
REPLAY-specific copy inventory. The schema must model physical copies, not just
game titles.

- Attendees search by title, player count, duration, complexity, and availability.
- A loan references one physical copy and records requested, approved/collected,
  checked-out, overdue, returned, missing/damaged, and resolved states.
- Staff see a live circulation queue and may override with a reason; all
  transitions are attributed and audited.
- The app shows collection point, return point, and due time.
- An offline paper/export ledger has a named reconciliation owner.

### Follow-up, not launch scope

Chat, profiles, matchmaking, looking-for-group, and other moderation-heavy
social features remain out of scope.

## Phase 1 architecture

```text
app.replaycon.in (Vite/React PWA)
        |
        | GET /api/app/bootstrap
        v
api.replaycon.in (Cloudflare Worker)
        |
        | curated service-role reads with explicit published filters
        v
Supabase: current published edition + published/cancelled schedule
          + active published announcements
```

- The attendee app is a separate build under `app/`, deployed as its own
  Cloudflare Pages project.
- The public bootstrap endpoint returns an allowlisted shape only. It applies
  `is_current`, `is_published`, schedule `public_status`, and announcement
  delivery-window filters even though the Worker uses the service role and
  bypasses RLS.
- The PWA stores only saved schedule IDs and the last public payload on-device.
- The endpoint is short-cacheable; the service worker prefers the network and
  falls back to its cached response.
- Phase 1 needs no database migration. The Phase 2 announcement slice adds the
  private `announcements` table; browser roles have no direct table grants.

## Phase 1 public data contract

The bootstrap response contains:

- `generated_at` and event timezone;
- safe edition fields: slug/name, dates, daily hours, and venue;
- safe schedule fields: public programme copy, location, host, sign-up mode/link,
  order, and public status;
- active announcement fields: title/message, severity, audience, delivery
  window, and last-update time.

It deliberately excludes users, registrations, leads, orders, payment state,
admin notes/audits, personal agendas, and all ticket or QR identifiers.

## Definition of done

Phase 1 is ready for a preview deployment when:

- Worker unit tests cover the published filters, empty edition state, query
  failures, allowlisted output, cache headers, and route wiring;
- app unit tests cover event-time calculations, now/next selection, filters,
  and local agenda persistence;
- the app builds with a valid manifest and service worker;
- offline reload works after one successful online visit;
- mobile and desktop layouts are keyboard-usable and readable at 200% zoom;
- root, app, admin, and Worker test/build/typecheck gates remain green; and
- deployment owners create the separate Pages project and deliberately deploy
  the Worker before pointing `app.replaycon.in` at the app build.

## Launch decisions still required

- Confirmed venue, address, venue floor plan, and accessibility annotation owner.
- Same-day support route and incident communications owner.
- Announcement publisher roles and urgent-message approval rules.
- Identity/recovery choice, QR security, session retention, and privacy copy.
- Library inventory source, library owner, loan duration, and offline ledger
  reconciliation owner.
- Named owners for check-in source of truth, offline reconciliation, and the
  authority to pause ticket sales.
