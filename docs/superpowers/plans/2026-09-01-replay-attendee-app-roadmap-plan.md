# REPLAY attendee app — implementation plan

Companion to `docs/superpowers/specs/2026-09-01-replay-attendee-app-roadmap-design.md`.
Read the spec first for the *why*; this document is the *how*, broken into
tasks sized for a working session.

## Status as of 2026-09-02

**Shipped: P0, P2A, P2B, P2E, P2C, P2D, P3.** Every phase on the critical path
is live in production.

**P0-P4 and P6 are shipped. P5 was removed. P7 is open** — see below; it is
the only outstanding phase.

The handoff section at the bottom was written when P4 and P6 were ahead rather
than behind. Its ground rules still apply to any work in this repo; its P4 and
P6 sections are now a record of what was built.

## How to use this plan across sessions

Phases are ordered by dependency. **Do not start a phase until the one it
depends on is deployed**, not merely written — the Worker must be live before
the app that calls it.

The phase headings below carry `Shipped` callouts recording what changed during
implementation. Trust those over the task lists beneath them: the tasks are
what was planned, the callouts are what happened.

### Standing gates — every task, every phase

- `npm test` · `npm run build` · `npm run test:app` · `npm run check:app`
- `npm test` and `npm run build` in `admin/`
- `npm test` and typecheck in `worker/`
- `npm audit` separately in all three dependency trees
- New or changed screens pass the P0 UI check (375 / 768 / desktop, light and
  dark, 200% zoom)
- **Deploy order: Worker first, then Pages projects.** Non-negotiable when a
  contract changed.

### Conventions to follow

- New tables: RLS on, `revoke all from anon, authenticated`, minimum grants to
  `service_role`. Copy the shape of
  `supabase/migrations/20260821132252_attendee_announcements.sql`.
- Admin mutations write to `admin_audit_log` via `worker/src/admin/audit.ts`.
- `actor_email` comes from the verified Access JWT, never a request body.
- Worker handlers live one-per-file in `worker/src/` or `worker/src/admin/`,
  each with a colocated `.test.ts`.

---

# P0 — UI validation and fixes

> **Shipped 2026-09-01.** Findings recorded in
> `docs/superpowers/notes/2026-09-01-ui-audit.md`. Two follow-on rounds of
> fixes landed 2026-09-01 and 2026-09-02, the second covering the nav icons,
> the card disclosure, and the app icon.

Independent of everything else. Do it first.

### Task 0.1 — Audit

Start this session's own preview server (another session's dev server is not
reachable from here). For each of the three surfaces, walk every route at
375px, 768px, and desktop, in light and dark, at 100% and 200% zoom.

Record findings in a table — surface, route, element, symptom, suspected cause
— **before** changing anything. Write it to
`docs/superpowers/notes/2026-09-01-ui-audit.md`.

Look for: spacing that is off the scale, misaligned siblings, touch targets
under 44px, clipped or overflowing text at 200%, horizontal body scroll,
optical misalignment in icon-plus-text rows, and inconsistent card padding.

### Task 0.2 — Fix in passes

Group fixes by cause, not by page — a spacing token applied inconsistently is
one fix, not nine. Prefer correcting the shared component or token over
patching call sites.

Remember: Astro scoped `<style>` changes need a dev-server **restart**, not a
reload. A reload will show you stale CSS and cost an hour.

### Task 0.3 — Verify and record

Re-walk the audit table, screenshot before/after for anything structural, and
mark each row fixed or deliberately accepted.

**Done when:** every row is resolved or explicitly accepted with a reason, and
no surface scrolls horizontally at any tested width.

---

# P2A — Kiosk check-in

> **Shipped 2026-09-01.** The rule that mattered most is enforced in the
> database, not the Worker: `enforce_check_in_day_purchased()` makes it
> impossible to check someone in for a day they did not buy, whatever the
> caller does. `check_in_events` is append-only, with `update`, `delete` and
> `truncate` revoked from `service_role` — a plain `grant select, insert`
> restricts nothing, because Supabase's defaults had already granted the rest.

### Task 2A.0 — Attendees table and backfill

**Do this first. Every table in every later phase keys on `attendee_id`, so
getting it wrong here means re-keying five tables against live data.**

`supabase/migrations/<ts>_attendees.sql` — the `attendees` table per the spec,
with `attendees_seat_per_registration` unique on `(registration_id, seat_index)`.

Backfill in the same migration: for every existing registration, insert `seats`
rows. Seat 1 takes the buyer's `user_phone`, the linked user's name, and
`is_purchaser = true`; seats 2..n get nulls. Verify afterwards that
`sum(seats)` across registrations equals `count(*)` in `attendees` — a mismatch
means guests are silently missing.

**Seat rows are created by trigger, not application code.** There are two
registration paths (public `register.ts` and the admin's manual add), and a
registration without its seats is invisible until someone cannot be found at the
door — so the guarantee belongs in one place the application cannot skip. An
`after insert on registrations` trigger creates seats 1..n; seat 1 inherits the
buyer's phone and name, the rest start anonymous. This follows the existing
`registrations_capacity_guard` precedent in `004_fundamentals_hardening.sql`.

Editing `seats` reconciles through a second trigger: increasing appends;
decreasing removes trailing rows **only while they carry no history** — no
check-in, no sign-ups, no loans. A seat with history is a person, and deleting
them takes their records with them. Since those tables do not exist yet, later
migrations replace the reconcile function as each dependent table appears.
**Do not forget this** — the guard is incomplete until they do.

Verify after backfill that `sum(seats)` across registrations equals
`count(*)` in `attendees`. As of 2026-09-01 production holds 243 registrations
and 273 seats, of which 20 registrations cover more than one person and the
largest covers ten.

### Task 2A.1 — Migration

`supabase/migrations/<ts>_check_in_events.sql` — the `check_in_events` table
keyed on `attendee_id`, both indexes, RLS, and grants of **`select, insert`
only** to `service_role`. No `update`, no `delete`; undo is an append.

Add a `before insert` trigger enforcing that `day` is present in the attendee's
`registrations.days`. A day-1-only ticket must never produce a day-2 check-in,
and that rule belongs in the database rather than only in the handler — the
service role bypasses RLS, so a handler bug would otherwise write an invalid
row unchallenged. Test it by attempting the invalid insert directly.

### Task 2A.2 — Check-in state helpers

`worker/src/admin/check-in-state.ts`, two distinct pure functions. Ignore any
event named by a later `voids_event_id` in both. No I/O, exhaustively unit
tested — this is the piece most likely to harbour a subtle bug, so test it
hardest.

- `currentState(events)` → `{ day1: 'in'|'out'|null, day2: ... }`. Where the
  person is now. For the desk display.
- `hasArrivedToday(events, day)` → boolean. True if any non-voided `in` event
  exists for that day, **regardless of a later `out`**. This is what gates
  pairing and sign-ups.

Keep them separate. Someone who stepped out for lunch is still an attendee and
must not lose the ability to book; collapsing these two questions into one
function is how that bug gets introduced.

### Task 2A.3 — Admin handlers

`worker/src/admin/check-in.ts`:

- `GET /api/admin/check-in/search?q=` — current edition,
  `payment_status = 'confirmed'`, cap 20 registrations. Matches three ways:
  the **purchaser's phone** (`registrations.user_phone`, the primary path), any
  **attendee's own phone**, and an **attendee name** prefix. The name and
  attendee-phone paths exist for the guest who arrives alone and does not know
  who bought the ticket.

  Groups results by purchaser so one search returns every seat that phone paid
  for, **across registrations** — a later top-up is a separate registration and
  must not be a separate search. Keeps the registration grouping underneath,
  since day validity belongs to the registration.

  Returns per attendee: display name or "Guest N", last four phone digits only,
  pass type, days, and that attendee's per-day state.

- `POST /api/admin/check-in` — `{ attendee_id, day, kind, client_event_id,
  display_name?, phone? }`. When name or phone are present, writes them to the
  attendee **in the same operation** as the event. One action, because the desk
  is the only moment the person is reliably standing there.

  Insert; on unique-violation of `client_event_id` return the existing event
  with 200, not an error. That is what makes offline replay safe. Name and phone
  are always optional — a blocked check-in is worse than a nameless one.

  If the phone already belongs to another attendee in this edition, return a
  **warning alongside success**, never a rejection. Couples and families share
  numbers, and pairing does not depend on the phone being unique.

- `POST /api/admin/check-in/bulk` — a list of `{ attendee_id, client_event_id,
  display_name?, phone? }` for "check in all" and for a couple arriving
  together. Report partial success per attendee rather than failing the batch.
- `POST /api/admin/check-in/undo` — `{ event_id, client_event_id }`, appends a
  voiding event.
- `PATCH /api/admin/attendees/:id` — set `display_name` and `phone` later, for
  details captured after the fact.

All three write to `admin_audit_log`.

### Task 2A.4 — Route wiring

`worker/src/index.ts`, inside the existing `/api/admin/` Access-guarded block.

### Task 2A.5 — Admin check-in screen

`admin/src/pages/CheckIn.tsx` — search focused on load, defaulting to the
purchaser's phone. Results group every seat that phone paid for under one
header, with the registration grouping visible underneath because day validity
belongs to the registration.

Each seat row carries its own state, its own large check-in button, and inline
**name and phone fields** filled at the moment of check-in. "Check in all" for
groups arriving together. Undo per attendee. Use `useOnlineStatus`.

Two things to hold onto while building it:

- **The single-seat case is the common one and must stay a one-tap operation.**
  A seat that already has a name and phone — the purchaser checking themselves
  in — should need no typing at all. Do not make everyone pay for the group case.
- **Nothing blocks on identity capture.** Empty name and phone check in fine;
  the fields are a prompt, not a gate. A duplicate phone shows a warning next to
  the field and still submits.

An attendee whose ticket does not cover the current day still appears in
results, with a disabled button and an explicit "not on this ticket" reason.
Never filter them out: a person missing from search reads as a broken system to
whoever is on the door, and invites manual improvisation.

Offline queue in IndexedDB: generate `client_event_id` **before** queueing,
show a visible pending count, flush on reconnect. Add to nav and router.

### Task 2A.6 — Roster export

Extend `admin/src/lib/csv.ts` for a printable confirmed-registration roster for
the current edition — the paper fallback.

**Phase done when:** a simulated network drop mid-check-in reconciles cleanly on
reconnect with no duplicate events, and the roster prints.

---

# P2B — Identity: pairing, device tokens, QR

> **Shipped 2026-09-01.** Three things changed from the tasks below during
> implementation, and they are the parts worth knowing:
>
> 1. **The QR is minted at pair time**, not when the code is issued — it has to
>    reach the attendee's device, and only the pair response goes there.
>    Re-pairing therefore rotates it, so a lost phone stops borrowing games.
> 2. **The pairing gate relaxes outside the event** to "arrived on any covered
>    day", via a shared `pairingGateDay`. Without it, pairing would first run for
>    real at the door on day one.
> 3. **`pairing_codes.attempts` has no writer.** With the code as sole
>    credential the lookup is by hash, so a wrong guess matches no row and there
>    is nothing to count against. Entropy plus the two rate limiters is the
>    defence. The column was left in place rather than migrated away.

### Task 2B.1 — Migration

`pairing_codes`, `attendee_devices`, `attendee_credentials` per the spec, with
their partial unique indexes.

### Task 2B.2 — Crypto helpers

`worker/src/attendee-tokens.ts`:

- `generateToken()` — 256-bit random, base64url.
- `generateQrToken()` — 128-bit random, base32 (Crockford; no ambiguous chars,
  since these get read aloud and re-keyed).
- `generatePairingCode()` — **eight Crockford base32 characters**, rejection-
  sampled from `crypto.getRandomValues` so the distribution is uniform. **Do
  not use `Math.random()`.** Normalise on input: uppercase, strip spaces and
  hyphens, and map Crockford's confusable characters (`I`/`L` → `1`, `O` → `0`)
  so someone reading it off a screen cannot fail on an ambiguity.
- `hashToken(raw)` — SHA-256, hex.

### Task 2B.3 — Issue pairing code

`POST /api/admin/check-in/pairing-code` in `worker/src/admin/check-in.ts`.
Body `{ attendee_id }`. Requires `hasArrivedToday` for that attendee — not that
they are currently inside. Invalidates any outstanding unconsumed code for them,
inserts the new hash with a 3-minute expiry, returns the plaintext code
**once**. Also mints an `attendee_credentials` row (the QR) if none is live.

**Repeatable by design.** An attendee who skipped the app at check-in and comes
back three hours later gets a fresh code from the same button. There is no
one-shot window and no "already issued" error state.

Each seat gets its own code. The kiosk shows a code per person, so a group of
three pairs three phones — never one code shared between them.

### Task 2B.4 — Pair exchange

`worker/src/app-pair.ts` — `POST /api/app/pair`, public.

Body `{ code }` — no phone. Normalise, hash, and look the code up directly;
it is the sole credential and is strong enough to be one. Reject if expired,
consumed, or past 5 attempts. On success mark consumed, mint an
`attendee_devices` row keyed on `attendee_id`, revoke prior devices for that
attendee, and return `{ token, expires_at, display_name, qr_token }`.

Rate limit via `SUBJECT_RATE_LIMITER` keyed on the client, plus
`PUBLIC_RATE_LIMITER`, since there is no phone to key on. Return an identical
generic error for every failure mode — a distinct "code not found" versus
"code expired" tells a prober which guesses were close.

### Task 2B.5 — Device auth middleware

`worker/src/attendee-auth.ts` — `requireDevice(req, sb)` reads the
`Authorization: Bearer` header, hashes, looks up, rejects revoked or expired,
bumps `last_seen_at`, returns `{ attendee_id, registration_id, edition_id }`.

Separately, `requireCheckedInToday(...)` for the routes that need it — kept as
its own function so the gate is applied deliberately per route rather than
being an invisible side effect.

### Task 2B.6 — QR resolve for staff

`POST /api/admin/scan` — `{ qr_token }` → registration summary: name, pass
type, per-day check-in state, active loans (empty until P4). Access-gated, so
the QR is only ever a handle.

### Task 2B.7 — App: pairing client and ticket screen

`app/src/lib/device.ts` — token in `localStorage`, attach to requests, clear on
401. `app/src/components/Ticket.tsx` — name, pass, per-day state, QR.

QR rendering needs an encoder. Pick a small dependency, or hand-roll — either
way it must render **offline**, so no image API.

### Task 2B.8 — Admin: issue-code affordance

A "Get app code" button on every attendee row in `CheckIn.tsx`, enabled
whenever `hasArrivedToday` is true. Pressing it reveals the code large enough to
read across a desk, with its countdown to expiry and a "new code" button.

**Label every code with its attendee's name.** Two people from one purchase
standing at the desk together will each be issued their own code, and two
unlabelled codes on one screen is how someone types the wrong one — which would
pair their phone to the other person's identity. The name on the code is the
only thing that disambiguates them, and it is there because check-in captured
it moments earlier.

**Not** shown automatically after check-in. The desk is busy and most people
just want to get inside; this is a button staff press when someone asks for it,
including hours later.

Add the same affordance wherever staff look an attendee up, so nobody has to
find the check-in screen specifically to hand out a code.

**Phase done when:** a code paired on one device revokes the other, an expired
code fails cleanly, the QR resolves at `/api/admin/scan`, and an attendee
checked in three hours earlier can be issued a working code on request.

---

# P2E — First-run wizard

> **Shipped 2026-09-01.** One change from the tasks below: the install nudge
> shows on **every** browser open rather than once, because the single-nudge
> rule hid it behind "Finish setup" — which is everybody's state before the
> event, so the nudge never appeared for anyone. "Finish setup" stays as the
> persistent way back in.

### Task 2E.1 — Install prompt plumbing

`app/src/lib/pwa.ts` — port the `beforeinstallprompt` capture from
`admin/src/lib/pwa.ts`. Add `isStandalone()` via
`matchMedia('(display-mode: standalone)')` plus the iOS `navigator.standalone`
fallback, and a platform hint (`ios-safari` / `chromium` / `desktop` / `other`).

### Task 2E.2 — Wizard state

`app/src/lib/wizard.ts` — persisted step in `localStorage`, with
`{ step, dismissed, paired }`. Must survive reload and a next-day return.
Resolve to "complete" whenever a device token exists, so a paired user never
sees it again regardless of stored step.

### Task 2E.3 — Wizard UI

`app/src/components/Wizard/` — Welcome, Install, Pair.

- Every step skippable; the whole wizard dismissible; never blocks the schedule.
- Install step is platform-branched: real prompt on Chromium, illustrated
  Share → Add to Home Screen for iOS Safari, skipped entirely when already
  standalone, de-emphasised on desktop.
- Pair step takes **the code alone** — one field, no phone. Uppercase as the
  user types, accept spaces and hyphens, and normalise Crockford confusables so
  a mistyped `O` for `0` still works.
- **On success, name who you paired as** — "You're set, Priya" — before showing
  anything else. Two people from one purchase pair at the desk at the same
  moment with a code each, and typing the other person's is an easy slip that is
  otherwise invisible until someone finds a session they never booked. Naming
  the identity makes the mistake obvious while both people are still standing
  in front of staff, who can re-issue and re-pair on the spot.
- Copy frames guest as a full path: name what pairing *adds*, never imply the
  app is broken without it.
- Focus management on step change; `Esc` dismisses; honour
  `prefers-reduced-motion` on transitions.

### Task 2E.4 — Resume affordance

A persistent, dismissible "Finish setup" entry point for unpaired attendees.
Any gated action — Sign up, ticket — resumes the wizard at the pairing step
rather than showing a bare error. It disappears permanently once paired.

### Task 2E.5 — Failure copy

Distinct, actionable messages for: expired code, wrong code with attempts left,
too many attempts, and offline. Each says what to do next; the first three all
end at "ask at the desk."

Note the tension with Task 2B.4, which returns one generic error to avoid
telling a prober anything: the *app* can still distinguish locally between "you
typed fewer than eight characters" and "the server rejected it," so keep the
helpful specificity client-side and the vagueness server-side.

**Phase done when:** a guest can reach the schedule in one tap, an iOS user gets
correct install instructions, and pairing can be abandoned and resumed the next
day.

---

# P2C — Event sign-ups and waitlist

> **Shipped 2026-09-01.** Two things worth knowing:
>
> 1. **`RETURNING` on an `UPDATE` yields the NEW row.** `cancel_session_signup`
>    read the pre-update status from it, which meant the promotion branch was
>    unreachable and every waitlist would have silently frozen. Read the status
>    in a `SELECT` before the `UPDATE`.
> 2. **Sign-up modes were reduced to `('none','app')`** and `signup_url` was
>    dropped — `walk-in`, `advance` and `on-site` described nothing the app
>    could act on.

### Task 2C.1 — Migration

`capacity` on `schedule_items`, `signup_mode` check extended with `'app'`, and
the `session_signups` table with both indexes.

### Task 2C.2 — Atomic RPCs

Same migration or a follow-up. `sign_up_for_session` and
`cancel_session_signup` as `plpgsql` functions, both taking
`select ... for update` on the schedule row before counting.

`cancel_session_signup` promotes the oldest waitlisted row in the same
transaction and stamps `promoted_at`.

**Test with genuine concurrency** — fire simultaneous sign-ups at a one-seat
session and assert exactly one `confirmed`. A sequential test proves nothing
here.

### Task 2C.3 — Worker routes

`worker/src/app-signups.ts` — `GET /api/app/me/signups`,
`POST /api/app/signups`, `DELETE /api/app/signups/:id`. All require a device
token; the two mutations additionally require `requireCheckedInToday`.

Reject sign-up unless `signup_mode = 'app'`.

### Task 2C.4 — Bootstrap seat counts

Add remaining-seat counts for `signup_mode = 'app'` items to
`/api/app/bootstrap`. Counts only — never who signed up.

### Task 2C.5 — Admin

Capacity field and the `app` mode in `ProgrammeDrawer.tsx`. New session roster
page: confirmed plus waitlist, manual promote, and **"add attendee"** — search
by phone, pick the person, run the same `sign_up_for_session` RPC with their
`attendee_id`.

`POST /api/admin/sessions/:id/signups` behind the Access gate, audited with the
staff member's email. Same capacity rules, same waitlist behaviour; the only
difference from the app path is who pressed the button.

Without this, declining the app means being shut out of the programme — the app
becomes mandatory rather than convenient. It is a small addition because the RPC
already keys on `attendee_id`.

### Task 2C.6 — App

Sign-up button on bookable items with seats remaining or waitlist position.
Sign-ups surface in My Day. Unpaired users get the wizard, not an error.

---

# P2D — Push notifications

Most involved phase. Give it its own session.

### Task 2D.1 — VAPID keys

Generate a P-256 keypair. Private key as a Worker secret (`VAPID_PRIVATE_KEY`),
public key in `[vars]` as `VAPID_PUBLIC_KEY`. **Never commit the private key.**

### Task 2D.2 — Web Push implementation

`worker/src/web-push.ts`, against WebCrypto — the Node `web-push` library does
not run in Workers.

- VAPID JWT per RFC 8292: ES256, `aud` = the push endpoint's origin, ~12h `exp`.
- Payload encryption per RFC 8291: ECDH P-256 with the subscription's `p256dh`,
  HKDF with the `auth` secret, AES128GCM, `aes128gcm` content encoding.

Test with the known-answer vectors from the RFCs. This is the one place in the
codebase where rolling your own crypto is correct, and also the one place where
a silent bug produces notifications that simply never arrive.

### Task 2D.3 — Migration

`push_subscriptions` per the spec, with per-category preference flags.

### Task 2D.4 — Subscribe and unsubscribe

`worker/src/app-push.ts` — `POST /api/app/push/subscribe`,
`DELETE /api/app/push/subscribe`, `PATCH /api/app/push/preferences`. Device
token required.

### Task 2D.5 — Service worker handlers

`app/public/sw.js` — `push` and `notificationclick`. Click routes to the
relevant screen (the session, the announcement). Handle a payload-less push
defensively.

### Task 2D.6 — Send helper and dead-subscription pruning

`worker/src/push-send.ts` — fan out to a registration's subscriptions,
respecting category flags. On `404`/`410` mark revoked; count and back off
other failures. A dead endpoint must never be retried forever.

### Task 2D.7 — Triggers

- **Waitlist promotion** — after `cancel_session_signup` promotes someone.
- **Urgent announcements** — on publish where severity is `urgent` or
  `incident`. Never for `info`.
- **Session reminders** — see next task.

### Task 2D.8 — Cron trigger

Add `[triggers] crons = ["*/5 * * * *"]` to `worker/wrangler.toml` and a
`scheduled` handler beside the existing `fetch` in `index.ts`.

Find sessions starting inside the reminder window whose confirmed attendees
have not been reminded; send; stamp `reminded_at`. **Cron delivery is
at-least-once, so the stamp is what makes this safe** — without it a hiccup
sends the same reminder twice.

### Task 2D.9 — Consent UI

Ask at the moment of value — joining a waitlist — never on first load. A
preferences screen with the three category toggles and a clear off switch.

**Phase done when:** a real notification arrives on both an Android and an iOS
installed PWA, a revoked subscription is pruned, and reminders do not double-send
across two cron ticks.

---

# P3 — Attendee ticket surface

> **Shipped 2026-09-02.** `GET /api/app/me/pass` (`worker/src/app-pass.ts`)
> plus the ID tab in `app/src/components/IdCard.tsx` and the formatting helpers
> in `app/src/lib/pass.ts`.
>
> The "keep My Day local" recommendation below **was reversed** — starred
> sessions now sync to `saved_items` so the reminder cron can read them. The
> reasoning is in the spec's P3 section.

---

# P4 — Game-library circulation

> **Shipped 2026-09-04.** The inventory decision was made on 2026-09-02:
> REPLAY-owned copies, which include the BGC catalogue anyway. It turned out to
> matter far less than this plan claimed — it shapes where title metadata comes
> from, not the loan model, which keys on copies either way.
>
> All five items below are done. Four things worth knowing:
>
> 1. **The four rules that matter are partial unique indexes**, not application
>    code: one live loan per copy, one live hold per copy, one game at a time,
>    one hold at a time. An index cannot be raced, and these are precisely what
>    two people tapping at once would break.
> 2. **Holds expire lazily.** The RPCs retire stale rows on their way past, so
>    there is no cron that can stop firing and leave copies locked.
> 3. **The closing-time rules relax outside the event**, exactly as
>    `pairingGateDay` does, so the whole flow could be rehearsed rather than
>    first run at the desk on day one.
> 4. **`library_titles` carries only key, bgg_id and title.** Rating, weight,
>    player counts and artwork stay in the committed snapshot; duplicating them
>    would have created a second source of truth that drifts on every
>    `sync:library`.
>
> Deliberately **not** built: an offline write queue for loans. See the note in
> `docs/LIVE_EVENT_READINESS.md`.

Once decided:

1. Migration: `library_titles`, `library_copies` (the physical things),
   `loans` with the full state machine. Model **copies, not titles**.
2. Staff flow: scan attendee QR via `/api/admin/scan`, pick a copy, issue.
3. Circulation queue with attributed overrides and audit.
4. Attendee: catalogue search by player count, duration, complexity,
   availability; my loans with due time and collection/return points.
5. Offline ledger export. (The "named reconciliation owner" this originally
   asked for was removed from scope on 2026-09-05 -- see the P4 section.)

---

# P5 — Removed from scope 2026-09-02

Venue-map accessibility annotations are not software work: they are factual
claims about a building that someone has to walk and verify.
`src/lib/venue-map.ts` already accepts them once established. Chat, profiles,
matchmaking and looking-for-group remain explicitly out of scope.

# P6 — Privilege model

> **Shipped 2026-09-05**, a year earlier than planned: the volunteer count
> reached ten, which is the point at which an environment variable stops being
> an honest way to say who may do what.
>
> `staff` (email, roles[]) replaces `ADMIN_EMAILS`. Five roles rather than the
> four planned — `basic_admin` was added during the build, being everything a
> full admin does except edit the staff table. That is the only privilege
> boundary that matters: a role that can edit staff can grant itself every
> other role.
>
> Four things went beyond the original scope:
>
> 1. **Cloudflare Access is synced from the table.** Adding somebody used to
>    mean editing a dashboard policy *and* a Worker secret, one of which needed
>    a deploy. Now it is one screen. The sync preserves rules it did not create
>    and never writes an object it could not first read.
> 2. **Authorisation is method-aware.** Every member of staff can read the
>    programme, notices and bookings; only the role that owns a page can write
>    to it.
> 3. **Bookings read that way are redacted** — no money, phone masked to the
>    last four digits.
> 4. **The last full admin cannot be removed or demoted**, by a database
>    trigger rather than by application code, so it holds whichever caller is
>    wrong.
>
> `verifyAccessJwt` now only authenticates. Authorisation is one check in front
> of all fifty-two admin routes, so a route added later inherits it instead of
> being open until somebody remembers.


---

# P7 — Booking management in the admin

Opened 2026-09-05. Attendees can book sessions from the app, and the admin can
only see that one session at a time.

**What already exists** — do not rebuild it. `/programme/:id/roster` shows a
single session's confirmed list and waitlist in queue order, and lets staff add
or remove somebody. It is reachable from the Programme list, on bookable
sessions only.

**What is missing**, in the order it is likely to be wanted:

1. **The reverse view: what has this person booked.** Nothing answers it. A
   pass scanned at the door or at the library counter says who somebody is and
   what they have borrowed, and nothing about the three sessions they are
   holding seats in. This is the gap that will be felt first, because it is the
   question an attendee asks in person.
2. **One view across the programme.** Seeing the state of the day means opening
   four rosters one at a time, which nobody will do while standing up. A single
   list of bookable sessions with taken and free seats, waitlist depth, and the
   ones that have filled.
3. **Export.** The check-in roster has a CSV; sessions have none. Same argument
   as the library ledger: when the network goes, paper takes over.

Notes for whoever builds it:

- `session_signups` already holds everything needed. Queue position is derived
  from `signed_up_at` rather than stored, so read it the way
  `handleSessionRoster` does rather than inventing a second answer.
- Cancelling a seat promotes the next person and notifies them. Any new way to
  remove somebody must go through `cancel_session_signup`, not a direct update,
  or the waitlist silently stops moving.
- Attendee-facing booking is done and needs nothing. This phase is admin
  visibility only.

---

# Handoff — P4 and P6

Written 2026-09-02 for a session that did not build any of the above. Read this
before the phase sections; it is what is not obvious from the code.

## Ground rules that have already cost time

These were each learned by getting them wrong. They apply to any phase.

**Never run `supabase db push`.** Local and remote migration histories are
permanently divergent. Apply a migration by running its SQL through the
Supabase MCP `execute_sql` against project `qvkynwlmzeybdiapbcsy`, then record
it so `migration list` lines up with the filename:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('<file timestamp>', '<name_without_timestamp>')
on conflict (version) do nothing;
```

Prefer that over MCP `apply_migration`, which invents its own version and
leaves the file's timestamp permanently unmatched. **Validate first** by
running the whole migration inside `begin; ... rollback;` with a `select` at
the end that proves the grants came out right.

**`grant select, insert` on a new table restricts nothing.** Supabase's default
privileges have already given `service_role` the rest. Every new table needs an
explicit `revoke` of what the Worker must not do — see `saved_items` and
`check_in_events` for the two shapes (delete allowed, delete forbidden).

**`replay-app` is not git-connected.** Merging or pushing does nothing for the
attendee app. It ships only via:

```
npm run build:app
npx wrangler pages deploy app/dist --project-name=replay-app
```

`replay-website` and `replay-admin` do build on push to `main`. The Worker
deploys only via `npm run deploy` in `worker/`. **Order: migration → Worker →
Pages.**

**A Pages deployment appearing in the list is not proof the build finished.**
Fetch a real asset from the deployment's own `<id>.pages.dev` URL — it 404s at
every path until the build lands.

**Add every new HTTP method to `CORS_HEADERS`.** The app and the API are on
different origins, so every call is cross-origin. A missing method fails at
preflight and surfaces in the app as a generic network error, which reads as
"you are offline" — it has already happened twice, to `DELETE` and `PUT`.

**Anything sent after a response returns needs `ctx.waitUntil`.**

## P4 — Game-library circulation

### The one decision that blocks everything

**Import the BGC catalogue, or maintain REPLAY-owned copies?** It determines
the schema and cannot be deferred into implementation. Do not start P4 without
an answer.

### What already exists — do not rebuild these

Roughly half of what P4 sounds like is already in the repo:

- **`src/data/game-library.json`** — a committed snapshot of **586 games** with
  `bggId`, `title`, `year`, `thumb`, `minPlayers`, `maxPlayers`, `minTime`,
  `maxTime`, `rating`, `weight`, `bestWith`, and a `copies` **count**. This is
  most of the attendee-facing catalogue search already.
- **`scripts/sync-game-library.ts`** (`npm run sync:library`) rebuilds that
  snapshot from the BGC Supabase project plus four BoardGameGeek collections.
  Read its header before touching it: BGG closed its public APIs, the `.tsv`
  harvests have to be re-gathered through a real browser, and the snapshot is
  committed deliberately rather than fetched at build time.
- **`src/pages/library.astro`** — the existing public library page.
- **`POST /api/admin/scan`** (`worker/src/admin/pairing.ts`) already resolves an
  attendee's QR for staff. The scan half of the issue flow exists.
- **`attendee_credentials.qr_token_hash`** — the QR is minted at pair time and
  re-pairing rotates it, so a lost phone stops borrowing games.

### What is actually missing

The catalogue is largely solved; **circulation is not**. In dependency order:

1. Expand `copies: "2"` into individual physical copy rows. **Model copies, not
   titles** — three copies of Catan are three borrowable things.
2. `loans` with the full state machine: requested, approved/collected,
   checked-out, overdue, returned, missing/damaged, resolved. Every transition
   attributed and written to `admin_audit_log` via `worker/src/admin/audit.ts`,
   with `actor_email` from the verified Access JWT and never from a body.
3. Staff issue/return flow: scan the QR, pick the copy, issue.
4. Circulation queue with attributed overrides.
5. Attendee-side: my loans, due times, collection and return points.
6. Offline paper ledger. Shipped as a printable sheet and a CSV.

   The original scope asked for a **named reconciliation owner** alongside it.
   Removed 2026-09-05: naming somebody in an export header buys nothing the
   export does not already give you, and who counts the shelf on Sunday is a
   rota question rather than a software one. It was raised repeatedly as
   outstanding work and was never work.

### Sizing

Several sessions, not one. The catalogue shortcut above makes it smaller than
the spec implies, but the loan state machine and the audit trail are the bulk
of it and neither compresses.

## P6 — Deferred privilege model

Not attendee-facing, and touches no app code.

`ADMIN_EMAILS` is read in exactly one place: `worker/src/access-auth.ts:93`,
which splits the comma-separated env var and checks the email from the verified
Cloudflare Access JWT against it. Everything admin-side funnels through that
check in `worker/src/index.ts`, so a role table replaces one function rather
than being threaded through every handler.

Roles wanted: check-in staff, library staff, programme editors, full admins.
The natural shape is a `staff` table keyed on email with a role column, read in
`verifyAccessJwt`'s caller, plus a per-route required-role map.

**Do this before the next edition scales the volunteer count**, not before this
one. The current allowlist is safe; it is simply coarse.

## Things known to be unfinished

- **The session-reminder push has never been proven against a real device.**
  Waitlist promotion has. The reminder job refuses to run unless today is the
  edition's `start_date` or `end_date`, so a live test means temporarily
  editing the current edition's dates in production — which the public site
  builds from and the check-in gate reads.
- **A cancelled session notifies nobody.** See open decision 6 in the spec.
- **`renotify` is not set on notifications.** A notification replacing an
  earlier one with the same tag arrives silently, which for a republished
  incident notice is probably wrong.
- **One admin Pages CI build failed unexplained** on 2026-09-01 (`db4ec7a`) and
  was not reproducible locally. It has not recurred across many deploys since,
  so it is most likely a one-off. The log is in the Cloudflare dashboard.
- **The library desk screen has never been driven by a human.** It sits behind
  Cloudflare Access and will not render locally without a JWT, so every button
  on it — hand over, take back, back-but-damaged, mark lost, put back, print
  ledger — is covered by tests and by nothing else. This is the largest
  untested surface going into the event and costs ten minutes to clear.
- **Last call and the closing-time cap are unexercised**, because both rules
  relax outside the event and today is outside it.
- **No human has signed in as anything but a full admin.** The role map has
  thirty-odd tests and none of them is a person discovering that a screen they
  need is missing. Ten volunteers now hold non-admin roles; one of them opening
  the admin before the event is worth more than any of those tests.
- **`ADMIN_EMAILS` is still set as a Worker secret and is read by nothing.**
  Left in place deliberately so a rollback has something to land on; delete it
  once the roles have been through an event.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Attendee rows not created for a new registration — the person cannot be found at the door | P2A | Create seats in the same operation as the registration, in both the public and manual paths; assert `sum(seats) = count(attendees)` after backfill |
| Guest seat with no name or phone breaks a later flow | P2A–P2C | "Guest N" is a supported state end to end; test check-in, pairing, and sign-up with a fully anonymous seat |
| Someone checked in for a day they never bought | P2A | Database trigger against `registrations.days`, not handler logic alone; tested by direct invalid insert |
| Attendee not covered today is missing from search and staff improvise | P2A | Show them with a disabled button and an explicit reason; never filter out |
| Web Push crypto silently wrong — notifications never arrive | P2D | RFC known-answer vectors; test on real iOS and Android devices before the event |
| Capacity race oversells a session | P2C | Row lock inside the RPC; genuine concurrency test |
| Offline queue double-checks-in | P2A | `client_event_id` unique index; replay test |
| Cron double-sends reminders | P2D | `reminded_at` stamp; at-least-once assumed |
| Screenshotted QR used for another's loan | P2B/P4 | Staff see the name on scan; rotation available as hardening |
| Kiosk tablet left signed in reaches all admin data | P2A | Addressed by P6: give the kiosk account `check_in` only, and it reaches nothing else |
| iOS install instructions wrong or stale | P2E | Test on a real iPhone, not a simulator viewport |
