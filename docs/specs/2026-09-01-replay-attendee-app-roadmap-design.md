# REPLAY attendee app — remaining roadmap design

> **Write-once record, closed 2026-09-06.** This is what was planned and
> what was learned building it, as at the time. It is not maintained and is
> not current state — see [`docs/DELIVERED.md`](../DELIVERED.md) and
> [`docs/ROADMAP.md`](../ROADMAP.md) for that.
>
> Paths inside it describe the `docs/superpowers/` layout that existed when it
> was written. They are left as they were rather than rewritten, because a
> write-once record that gets edited is not one.

Status: **P0-P4 and P6 shipped; P7 open.** P0, P2A–E and P3 by 2026-09-02; P4 on
2026-09-04; P6 on 2026-09-05. P5 was taken out of scope on 2026-09-02.
Companion plan: `docs/superpowers/plans/2026-09-01-replay-attendee-app-roadmap-plan.md`,
which carries the handoff notes for what is left.
Expands and partly supersedes `docs/ATTENDEE_APP_PLAN.md` Phases 2–4.

## Why this exists

Phase 1, the announcement slice, and the venue floor map are shipped. This
document designs everything that remains, in the order it can actually be
built, with the dependencies between phases made explicit — the work spans
several sessions and needs to be resumable at any phase boundary.

## Decisions taken

These were open in `docs/ATTENDEE_APP_PLAN.md` and are now settled.

| Question | Decision |
|---|---|
| Attendee identity flow | Kiosk-issued pairing code. Check-in *is* the identity event. No email, no magic link, no SMS OTP. |
| QR pass | **In scope.** Needed as the scan handle for game-library borrowing. |
| Check-in gate for sign-ups | Must be checked in **that day**. Evaluated at sign-up time. |
| Full sessions | Waitlist, with automatic promotion on cancellation. |
| Which sessions are bookable | Explicit opt-in per item via `signup_mode = 'app'`. |
| Lost or reinstalled phone | Re-pair at the desk; the previous device token is revoked. |
| Push notifications | **In scope.** Waitlist promotion, urgent announcements, and session-start reminders. |
| Check-in privileges | Admin app, existing `ADMIN_EMAILS` allowlist. Finer-grained roles are deferred, not rejected. |
| Multi-seat tickets | One `attendees` row per seat. Check-in, QR, pairing, sign-ups, and loans all key on the attendee, not the registration. |
| Pairing credential | Eight Crockford base32 characters, standing alone. No phone factor — guest seats have no phone on record. |

## The unit of everything is an attendee, not a registration

**This is the foundation the rest of the design rests on. Read it before any
schema below.**

One registration can cover several people. `registrations.seats` is a real
purchased quantity — `worker/src/register.ts` takes a `quantity`, and
`edition-spots.ts` counts those seats against per-day capacity. But only the
**buyer's** phone is stored. The friend on seat 2 does not exist as a record:
no name, no phone, no row.

Keying check-in, credentials, sign-ups, or loans on `registration_id` would
therefore collapse N humans into one, with concrete consequences: a three-seat
registration could hold exactly one seat in a session, carry one shared QR, be
checked in only as an indivisible blob, and give the friend no way to sign up
for anything on their own phone.

So every personal record in this roadmap keys on `attendee_id`.

```sql
create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  seat_index int not null check (seat_index > 0),
  display_name text,
  phone text,
  is_purchaser boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendees_phone_format check (phone is null or phone ~ '^[0-9]{10}$')
);

create unique index attendees_seat_per_registration
  on public.attendees (registration_id, seat_index);
create index attendees_edition_phone on public.attendees (edition_id, phone);
```

`display_name` and `phone` are nullable because a guest seat genuinely has
neither until someone asks. Staff capture them at the desk if the attendee is
willing; "Guest 2" is a valid, working state and must stay valid all the way
through — a guest who declines to give a phone number still needs to check in,
pair, sign up, and borrow.

`registrations.seats` remains the billing quantity. The `attendees` rows are the
people. A backfill creates one row per existing seat, with seat 1 carrying the
buyer's phone, name, and `is_purchaser = true`.

### One phone, several registrations

Buying another seat later creates a **new registration** for the same phone
rather than editing the first. As of 2026-09-01, 17 phone/edition pairs in
production hold more than one registration.

A naive "seat 1 is the purchaser" rule would therefore give one human two
attendee records — two QRs, two pairings, and the ability to take two seats in
the same session — while recording the guest they actually bought for as the
buyer. Measured against production data, that would have produced 25 duplicate
identities out of 243 registrations.

So **the purchaser identity attaches to at most one attendee per (edition,
phone)**. Later registrations for that phone create anonymous seats, which is
what they are: additional people. The desk names them at check-in, and search
still finds them because it matches `registrations.user_phone` as well as
`attendees.phone`.

### The consequence that simplifies things

Pairing can no longer use the phone number as its second factor, because guest
seats have no phone on record. Rather than branch the flow, the pairing code
becomes strong enough to stand alone: **eight Crockford base32 characters**
(~40 bits) instead of six digits.

That is a better design than what it replaces. One flow for buyers and guests
alike, no phone field in the wizard at all, and a credential that cannot be
found by guessing against the pool of live codes — which was the actual weakness
of six digits, not the absence of a phone.

### On the deferred privilege split

Accepted with eyes open: every admin can check people in, and every check-in
volunteer can also reach registrations, payments, leads, and promo codes. The
mitigation for now is operational — don't leave the kiosk tablet unattended and
signed in. A `CHECKIN_EMAILS`-style narrowing, and later a real role table, is
recorded as Phase 7 rather than dropped.

## Phase map

```
SHIPPED ── P1 public utility · announcements · venue map
              │
   ┌──────────┴─────────────────────────────────────────┐
   │                                                     │
 P0 UI audit and fixes ✓                        P2A Kiosk check-in ✓
                                                         │
                                                 P2B Identity: pairing,
                                                     device tokens, QR ✓
                                                         │
                                                    P2E First-run wizard ✓
                                                         │
                              ┌──────────────┬───────────┴──────┬─────────────┐
                              │              │                  │             │
                      P2C Sign-ups ✓  P3 Ticket surface ✓   P4 Library    (P2D needs 2C)
                        + waitlist                        circulation
                              │                            ⛔ BLOCKED
                              └────────► P2D Push ✓
                                              │
                                        P6 Deferred roles
```

Everything on the critical path — **P2A → P2B → P2E → P2C → P2D** — is shipped,
as are P0 and P3.

**What remains is P4 and P6, and they are unrelated to each other.** P4 depends
only on P2B, which exists, so it is startable the moment its inventory-source
decision is made. P6 touches no attendee-facing code at all.

P5 was removed from the roadmap on 2026-09-02. See below.

---

## P0 — UI validation and fixes

Reported: minor spacing and positioning problems across existing surfaces. Do
this before adding new UI, so new screens are built on a base that is already
consistent rather than inheriting drift.

**Method.** For each surface — public site, attendee app, admin — drive the
browser preview at 375px, 768px, and desktop widths, in both light and dark, at
100% and 200% zoom. Record every finding in a table with surface, element,
symptom, and cause before changing anything, so the fix pass is deliberate
rather than a series of nudges.

**What counts as a finding:** inconsistent spacing that does not sit on the
scale, misalignment between siblings, touch targets under 44px, text that
overflows or clips at 200%, horizontal body scroll at any width, and
inconsistent optical alignment in icon-plus-text rows.

**Standing gate.** Every subsequent phase adds its new screens to the same
check before it is considered done. Polish deferred to the end never happens.

Two known traps, both already learned the hard way and recorded in memory:
Astro scoped `<style>` edits need a dev-server restart, not a reload; and if
another session already has a dev server on this folder, this session's browser
tools cannot reach it — start a separate preview.

---

## P2A — Kiosk check-in

No attendee-facing change. Staff find an attendee by phone and tap.

### `check_in_events` — append-only

```sql
create table public.check_in_events (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  day text not null check (day in ('day1','day2')),
  kind text not null check (kind in ('in','out')),
  voids_event_id uuid references public.check_in_events(id),
  client_event_id uuid not null,
  actor_email text not null,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index check_in_events_client_dedupe
  on public.check_in_events (client_event_id);
create index check_in_events_state
  on public.check_in_events (attendee_id, day, occurred_at desc);
```

Re-entry is a new row; undo is a new row naming what it voids. Current state is
a fold over non-voided rows, **per attendee** — so a three-seat group where two
people have arrived reads correctly instead of being one ambiguous flag. `service_role` gets `select, insert` and
deliberately **no `update` or `delete`** — history cannot be rewritten, even by
a bug.

`client_event_id` is generated on the kiosk before the request is queued, so
replaying an offline queue collides on the unique index instead of
double-checking-in a person. That is the entire offline conflict-resolution
story; there is no merge logic to get wrong.

### Check-in is per day, per attendee, and staff-only

Three properties worth stating together, because they define the whole model:

- **Per day.** `check_in_events.day` is `day1` or `day2`. An attendee has an
  independent state for each day of the edition. Re-entry within a day is
  further `in`/`out` events on that same day, never a new day.
- **Per attendee.** Not per registration. Seat 2 of a three-seat ticket has its
  own state on each day.
- **Staff-only.** The attendee app never *performs* check-in; it only displays
  the state staff recorded. There is no self-check-in endpoint anywhere in this
  roadmap, and adding one would break the property that makes the sign-up gate
  meaningful — that a checked-in person is physically in the building.

### A day nobody bought can never be checked in

`registrations.days` is the purchased subset of `['day1','day2']`. A day-1-only
ticket must never produce a day-2 check-in.

This is enforced **in the database, not just the handler** — a trigger on
`check_in_events` resolves the attendee's registration and rejects any row whose
`day` is not in `days`. A Worker-side check alone would leave the rule one bug
away from being violated, and a bad check-in is the kind of error that surfaces
as an argument at the door rather than an exception in a log.

**The desk must say why.** An attendee whose ticket does not cover today has to
appear in search results with a clear "day 2 not on this ticket" state and a
disabled button — never be silently absent. Someone missing from search looks
like a broken system to whoever is on the door, and the fix they will reach for
is manual improvisation.

### The app is never required

Check-in is entirely staff-side and involves no app, no code, and no QR. An
attendee who never installs anything walks up, is found by phone, and is
checked in. That is the whole flow, and it stays the whole flow — the app is a
convenience layered on top, never a turnstile.

Issuing a pairing code is a **separate, repeatable staff action**, not a step
in check-in. Someone can check in on arrival, decide hours later that they want
the app after all, come back to the desk, and be handed a fresh code. Codes can
be reissued any number of times; each issue invalidates the previous one.

Pairing is not offered automatically after check-in either — the desk is busy
and most people just want to get inside. It is a button staff press when
someone asks.

### "Checked in today" means arrived today, not currently inside

The gate on pairing and sign-ups asks whether an attendee has a non-voided
`in` event for the current day — **not** whether their latest event is `in`.
Someone who steps out for lunch, or whose exit was recorded at a door, has not
stopped being an attendee and must not lose the ability to book a session.

This is deliberately a different question from the one the state helper answers.
`currentState()` reports where a person is now, for the desk's benefit;
`hasArrivedToday()` reports that they are genuinely at the convention today, for
the gate's. Implement them as two functions and do not let one drift into
serving both.

### Check-in is where the attendee list gets built

The desk asks every arrival for three things:

1. **The purchaser's phone** — what staff search on.
2. **Their own name.**
3. **Their own phone.**

Staff search the purchaser's phone, get every seat that phone paid for, pick the
one this person is taking, and write their name and number onto it as part of
checking them in. Not a separate edit afterwards — one action, so the identity
is captured at the only moment the person is reliably standing there.

This is what turns 55 anonymous seats into a real attendee list, and it is why
`display_name` and `phone` sit on the attendee rather than the registration.

**Capture is prompted, never enforced.** A blocked check-in is worse than a
nameless one: someone will refuse, or be a child, or be holding two bags and a
coffee. "Guest 2" therefore stays a fully working state end to end — check in,
pair, book, borrow — and staff can fill the details in later from the same
screen.

### Every arrival permutation has to work

Searching a purchaser's phone returns **all** their seats — across registrations,
since a later top-up creates a new one rather than editing the first. From that
one view staff can:

- check in a single attendee who bought for themselves;
- check in a couple on one registration together, naming the second person as
  they go;
- check in one of that couple now and the other three hours later;
- check in a guest whose seat came from a second, later purchase;
- check in the whole group at once.

Seats stay grouped by registration underneath, because day validity is a
property of the registration — one purchase may cover both days and another
only day 1.

**Search also matches an attendee's own phone and name**, not just the
purchaser's — but only once those details exist.

This is a real operational constraint, not a detail. A guest's name and number
enter the system when staff capture them at check-in, so on the first day the
**purchaser's phone is the only way to find them**. From their second check-in
onward — day 2, or a re-entry — they are findable by their own details. The
purchaser is the exception: seat 1 carries their phone from purchase, so they
are searchable immediately.

The desk copy has to say this plainly. Staff who believe name search always
works will ask a day-1 guest for their name, find nothing, and conclude the
system is broken.

**A phone already used by another attendee warns rather than blocks.** Couples
and families share numbers, and a hard uniqueness rule would turn a normal
arrival into an argument. Pairing does not depend on the phone being unique —
the code is the whole credential — so a shared number costs nothing.

### Search response is deliberately thin

Name, **last four digits of the phone only**, pass type, days, and per-attendee
check-in state. Capped at 20 registrations, current edition, confirmed
registrations only. The door does not need full phone numbers, emails, or
payment data on screen, and a masked capped response means a compromised kiosk
leaks far less than the existing registrations list already does.

`actor_email` always comes from the verified Access JWT, never the request
body, so attribution cannot be spoofed.

---

## P2B — Identity: pairing, device tokens, QR

### The pairing handshake

Staff check an attendee in; the kiosk shows an eight-character code with a
three-minute TTL; the attendee types it into the app; the app exchanges it once
for a device token.

The staff member standing in front of the attendee is the verification. It
works for attendees with no email — the exact thing that stalled the original
Phase 3 — costs nothing, needs no delivery channel that can fail on venue wifi,
and cannot be exercised remotely.

**A code is issued per attendee, not per registration.** Each person on a
multi-seat ticket pairs their own phone and gets their own device token, so the
friend on seat 2 books their own sessions rather than asking the purchaser to
do it.

**The code stands alone; there is no second factor.** Guest seats have no phone
on record, so binding the exchange to a phone number would leave them unable to
pair. Eight Crockford base32 characters is ~40 bits — un-guessable against the
pool of live codes, which is the property six digits lacked. One flow for
everyone, and no phone field in the wizard.

### Three credentials, three different jobs

This phase introduces three secrets. Keeping their roles distinct is what keeps
the security story simple:

| Credential | Lifetime | Who holds it | What it authorises |
|---|---|---|---|
| Pairing code | 3 min, single use | Attendee, briefly | Exchange for a device token |
| Device token | Event + 1 day | Attendee's browser | That attendee's own sign-ups and loans view |
| QR token | Event, rotatable | Attendee's screen | **Nothing on its own** — a lookup handle for staff |

### The QR is a handle, not a bearer credential

This is the important property. The QR resolves only through an
Access-authenticated admin endpoint, so the privilege comes from the *staff
session*, not from possessing the QR. A leaked QR image grants an attacker
nothing unless they are also a signed-in admin.

```sql
create table public.attendee_credentials (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  qr_token_hash text not null unique,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);

create unique index attendee_credentials_one_live
  on public.attendee_credentials (attendee_id)
  where revoked_at is null;
```

One QR per person, not per ticket — which is exactly what library borrowing
needs. Three friends on one registration can each have a different game out,
and the loan record names the right human.

The QR payload is an opaque 128-bit random value, base32-encoded, stored only
as a hash. It carries no name, phone, registration ID, or edition data — a
photographed QR reveals nothing by inspection.

**Residual risk, accepted:** someone who screenshots another attendee's QR
could have a library loan issued against that registration. Mitigations are
that staff see the attendee's name on scan and can eyeball the mismatch, and
that loans are physical hand-overs rather than instant digital grants. If this
proves to matter in practice, the hardening is a time-bucketed rotating QR;
that is deliberately *not* in v1 because it requires the app to hold a derivation
secret and stay clock-synced, which is a lot of machinery for a con.

### The gate on issuing a code

**During the event: arrived today.** That is what keeps "paired" meaning
"actually here", which the sign-up gate in P2C later rests on.

**Outside the event: arrived on any day this ticket covers.** Nothing is
bookable then, so the in-the-building rule has nothing to protect — and without
the relaxation the entire pairing flow would first be exercised at the door on
day one, which is the worst possible place to discover a problem. Both call
sites share one `pairingGateDay` function so the rule cannot drift between the
button's enabled state and the endpoint's answer.

### The QR is minted when pairing succeeds, not when the code is issued

Worth stating because the obvious design is the other way round. The QR has to
reach the *attendee's* device, and only the pair response goes there — the code
is handed over at the kiosk, which is the wrong surface entirely.

This also makes re-pairing do the right thing for free: pairing a new phone
revokes both the previous device token and the previous QR, so a lost handset
stops being able to borrow games the moment its owner sets up a replacement.

### Token storage rules, all three

Stored only as SHA-256 hashes, so a database leak yields nothing live. Device
tokens are returned to the client exactly once, kept in `localStorage`, sent in
an `Authorization` header, and **never** placed in a URL or query string.

### What a device token may do

List my sign-ups, sign up, cancel, view my loans, view my ticket. Responses
carry the attendee's own first name and their own records — never phone
numbers, emails, payment state, or any other attendee's data. The worst case
for a stolen device token is interference with one person's bookings.

---

## P2E — First-run wizard

The attendee's front door: a guided flow on first open that helps them install
the app to their home screen, then either pair or continue as a guest — and can
be resumed later to finish pairing.

### Three steps, none of them a wall

1. **Welcome** — what the app does, in a sentence.
2. **Install to home screen** — platform-aware, skippable.
3. **Pair or continue as guest** — one code field, or straight into the app.

Every step is skippable and the whole wizard is dismissible. It must never be a
modal wall between someone and the schedule; a person standing in a queue
looking up what starts next should get there in one tap.

### Guest is a first-class path, not a booby prize

Everything shipped in Phase 1 — now, schedule, My Day, map, event info, offline
— works without pairing and always will. The wizard must say what pairing
*adds* (sign up for sessions, borrow games, your ticket) rather than implying
the app is broken without it. The guest path is the default for anyone who has
not reached the desk yet, which on day one is everybody.

### Install guidance has to be platform-aware

There is no single install API:

- **Android / Chromium** — the `beforeinstallprompt` event gives a real prompt.
  `admin/src/lib/pwa.ts` already captures and re-publishes this event; the same
  pattern ports to the app.
- **iOS Safari** — no API at all. Needs illustrated instructions: Share, then
  Add to Home Screen. This is the fiddly one and it is worth getting the
  screenshots right, since a large share of attendees will be on iOS.
- **Already installed** — detect `display-mode: standalone` and skip the step
  entirely rather than telling someone to install an app they are inside.
- **Desktop** — de-emphasise; the app is mobile-first and installing on a laptop
  is rarely what anyone wants at a convention.

### Pairing is one field

The code is the whole credential — eight characters, no phone, no second field.
Guest seats have no phone on record, so a phone factor would have locked them
out entirely; making the code strong enough to stand alone serves everyone with
one flow and less typing.

Input handling carries the weight instead: uppercase as they type, accept
spaces and hyphens, and normalise Crockford's confusables so someone reading
`0` as `O` off the kiosk screen still gets in.

**Everyone on a multi-seat ticket pairs separately.** The kiosk issues a code
per person, so three friends pair three phones and each books their own
sessions. The wizard never needs to know a group exists.

Failure states need real copy: an expired code (get a fresh one at the desk), a
wrong code with attempts remaining, and too many attempts (return to the desk).

### Resumability

Wizard progress persists in `localStorage`, so a reload or a return the next
day does not restart it. An unpaired attendee sees a persistent but dismissible
"Finish setup" affordance, and any gated action — tapping Sign up on a session,
opening the ticket screen — resumes the wizard directly at the pairing step
rather than showing a bare error. After pairing succeeds the affordance
disappears for good.

Because pairing requires being checked in, most people will meet this wizard
twice: once at home as a guest, once at the desk with a code. It has to be
pleasant the second time, not just the first.

---

## P2C — Event sign-ups and waitlist

### Schema additions

```sql
alter table public.schedule_items
  add column capacity int check (capacity is null or capacity > 0);
-- extend the existing signup_mode check to include 'app'

create table public.session_signups (
  id uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references public.schedule_items(id) on delete cascade,
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  status text not null check (status in ('confirmed','waitlisted','cancelled')),
  signed_up_at timestamptz not null default now(),
  cancelled_at timestamptz,
  promoted_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index session_signups_one_live_per_person
  on public.session_signups (schedule_item_id, attendee_id)
  where status <> 'cancelled';
create index session_signups_queue
  on public.session_signups (schedule_item_id, status, signed_up_at);
```

The partial unique index makes a double-tap idempotent while still allowing
someone to sign up again after cancelling. Waitlist order is `signed_up_at` —
no position column to drift out of sync.

`signup_mode = 'app'` is an explicit opt-in. Setting a capacity number alone
does **not** make a session bookable; capacity may legitimately just describe
how many fit in a room.

### Capacity must be atomic

The real engineering risk in this phase is two people tapping the last seat at
the same instant, not the auth. PostgREST inserts will not serialise that, so
both mutations run as Postgres functions that take a row lock on the schedule
item and count within the transaction:

- `sign_up_for_session(attendee_id, schedule_item_id)` — locks the schedule
  row, counts confirmed sign-ups, inserts `confirmed` or `waitlisted`, returns
  the status and queue position.
- `cancel_session_signup(attendee_id, schedule_item_id)` — cancels, then
  promotes the oldest waitlisted entry in the same transaction and stamps
  `promoted_at` so P2D can notify.

### Staff can sign someone up at the desk

Sign-ups must not be app-only. An attendee who declines the app would otherwise
be shut out of the programme entirely, which turns a convenience into a
requirement and quietly excludes anyone without a capable phone, without
storage space for another app, or without the inclination.

So the session roster screen gets an "add attendee" action alongside the manual
promote: staff search by phone, pick the person, and the same
`sign_up_for_session` function runs with their `attendee_id`. Identical
capacity rules, identical waitlist behaviour, identical audit trail — the only
difference is who pressed the button.

This costs almost nothing to build, because the RPC already keys on
`attendee_id` and the roster screen already exists for promotion. It is the
difference between the app being useful and the app being mandatory.

The checked-in-today gate is evaluated **at sign-up time, not pairing time**. A
device paired on day 1 cannot book day 2 sessions until that attendee checks in
on day 2. That is what makes a booked seat mean someone actually in the
building.

---

## P2D — Push notifications

The most technically involved phase, and the one most likely to need its own
session. Push serves three jobs, only one of which is the waitlist:

1. **Waitlist promotion** — "a seat opened in Catan, you're in."
2. **Urgent and incident announcements** — the existing announcement severity
   levels finally get a delivery channel instead of waiting to be noticed.
3. **Session-start reminders** — "Werewolf starts in 15 minutes, Sandbox."

### Why this is more work than it looks

Cloudflare Workers cannot use the Node `web-push` library. Both halves of the
protocol have to be implemented against WebCrypto directly:

- **VAPID** (RFC 8292) — an ES256-signed JWT per push endpoint origin.
- **Payload encryption** (RFC 8291) — ECDH on P-256, HKDF, then AES128GCM.

Both primitives exist in the Workers runtime, so this is roughly 200 lines of
well-specified cryptography rather than a blocked path — but it is real work
and deserves its own tests with known-answer vectors from the RFCs.

### Scheduled reminders need new infrastructure

Session-start reminders require a Cloudflare **Cron Trigger** on the Worker —
a `[triggers]` block in `worker/wrangler.toml` and a `scheduled` handler
alongside the existing `fetch`. Running every five minutes, it finds sessions
starting in the next window whose confirmed attendees have not yet been
reminded, and sends. A `reminded_at` stamp makes the job idempotent, which
matters because cron delivery is at-least-once.

### Consent boundary

Push is strictly opt-in, asked for at a moment when the value is obvious — on
joining a waitlist — never on first app load. Categories are independently
toggleable, because someone who wants their waitlist seat may not want every
announcement:

```sql
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  wants_waitlist boolean not null default true,
  wants_announcements boolean not null default true,
  wants_reminders boolean not null default true,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0,
  revoked_at timestamptz
);
```

A `410 Gone` or `404` from the push service means the subscription is dead;
prune it rather than retrying forever. The VAPID private key is a Worker
secret and never reaches the client — only the public key does.

The service workers are hand-rolled at `app/public/sw.js`, so the `push` and
`notificationclick` handlers drop in directly with no plugin involved.

---

## P3 — Attendee ticket surface

> **Shipped 2026-09-02.** `GET /api/app/me/pass` returns the name from the
> attendee record, both event days with their calendar dates, whether the
> ticket covers each, and whether they have arrived on it. The ID tab renders
> that beneath the QR, with the "re-pair at the desk" recovery copy.
>
> Two things worth knowing:
>
> 1. **The name is read fresh, not taken from the stored device.** The desk can
>    rename a seat after pairing, and a pass still reading "Guest 2" at a door
>    is worse than no pass. The header and the card both use the fresh name, or
>    they name two different people.
> 2. **A day the ticket does not cover is shown, greyed, not hidden.** "Is
>    Sunday mine?" is the question the desk gets asked, and it is only
>    answerable here if the uncovered day appears at all.

**The "My Day stays local" recommendation was reversed on 2026-09-02.** This
document previously advised against syncing it — local costs nothing and cannot
leak. That held right up until reminders existed: a cron cannot read a phone,
so a star that never left the device could never become a notification, and
only four of day one's thirty-two published sessions take bookings at all. For
the other twenty-eight the star was the *only* way to say "I mean to be there".

So `saved_items` now mirrors a paired device's stars server-side, and the
reminder job unions them with confirmed sign-ups. The local set remains
authoritative for what the screen draws, and still works for someone who never
pairs. The privacy cost is real and was accepted deliberately: an attendee's
stars are now readable by the Worker where before they were readable by nobody.

---

## P4 — Game-library circulation

Depends on P2B only, so it can run parallel to P2C/P2D.

**Still blocked on one decision:** whether REPLAY imports an existing BGC
catalogue or maintains its own copy inventory. This is not a detail to settle
during implementation — it determines the schema, and the schema must model
**physical copies, not titles**. Three copies of Catan are three borrowable
things.

Shape once decided: `library_titles` (the catalogue metadata), `library_copies`
(the physical things, each with a barcode or label), and `loans` referencing
one copy with states requested, approved/collected, checked-out, overdue,
returned, missing/damaged, resolved. Every transition attributed and audited.

The staff flow is where the QR earns its place: scan the attendee's QR, scan or
pick the copy, issue. Attendee-side: catalogue search by player count,
duration, complexity, and availability; my loans with due times and
collection/return points.

An offline paper ledger is a launch requirement, not a nicety. Shipped
2026-09-04 as a printable sheet and a CSV.

The "named reconciliation owner" this asked for was removed from scope on
2026-09-05: who counts the shelf on Sunday is a rota question, and a name in an
export header buys nothing the export does not already give you.

---

## P5 — Removed from scope

**Taken out of the roadmap on 2026-09-02.**

P5 was accessibility annotations and marked exits on the venue floor plan. It
is not abandoned as a goal, but it does not belong in a software roadmap: every
item in it is a factual claim about a physical building, and the work is
walking the venue with someone who can verify step-free routes and exits — not
writing code. `src/lib/venue-map.ts` already accepts the annotations once
somebody has established what they are.

Chat, profiles, matchmaking and looking-for-group were listed here as
explicitly out of scope, and remain so.

## P6 — Privilege model

**Shipped 2026-09-05.** Deferred until the volunteer count forced it, which
happened during this edition rather than the next: ten people needed access,
and `ADMIN_EMAILS` gives everyone everything.

`staff` (email, roles[]) is the authority, synced to Cloudflare Access so
adding somebody is one screen rather than a dashboard edit plus a Worker
deploy. Five roles: `admin`, `basic_admin` (everything but the staff table),
`check_in`, `library`, `programme`. See the plan for what went beyond scope.

---

## P7 — Booking management in the admin

Opened 2026-09-05, after P2C put bookings in attendees' hands without giving
organisers a way to see them in aggregate.

The asymmetry is the point: an attendee knows exactly what they have booked,
and an organiser can only find out one session at a time. Three things close
it — what a given person has booked, one view across the whole programme, and
an export for when the network is not there.

Deliberately admin-only. Nothing about attendee booking changes.

## Cross-cutting rules

**The public bootstrap contract does not change.** No sign-up state, check-in
state, loan, or credential ever enters `/api/app/bootstrap`. Remaining-seat
counts are the one safe addition — they are not personal data.

**Personal data never enters a public payload.** Names, phones, emails,
registration IDs, payment state, and all token material stay behind either the
Access perimeter or a device token scoped to that one attendee.

**New public endpoints are rate limited.** `/api/app/pair` is the only genuinely
new public surface in this roadmap, throttled through the existing
`SUBJECT_RATE_LIMITER` keyed on phone, on top of its per-code attempt cap.

**Every new table follows the announcements precedent:** RLS enabled,
`revoke all ... from anon, authenticated`, and only the grants the Worker
actually needs to `service_role`. Browser roles reach none of it through the
Data API.

**Deploy order is fixed:** Worker first, then the Pages projects. Every phase
that changes a contract deploys the Worker before the app and admin builds.

## Open decisions

1. ~~**Library inventory source**~~ — settled 2026-09-02: REPLAY-owned copies,
   which include the BGC catalogue anyway. It shaped far less than this document
   claimed: it decides where title metadata comes from, not the loan model,
   which keys on copies either way. P4 shipped 2026-09-04.
2. ~~**Who owns capacity numbers**~~ — removed from scope 2026-09-05. It was
   never a software question: capacity is a number somebody types into the
   programme editor, and `signup_mode` is a checkbox beside it. Whoever edits
   the programme decides, the same way they decide a session's title. Raised
   three times as an open decision and it should not be raised a fourth.
3. **What happens to sign-ups and loans if a registration is cancelled** after
   the fact. Partly answered for the purchaser identity by
   `20260901184903_release_purchaser_claim.sql`; sign-ups and loans are still
   open.
4. ~~**Reminder lead time**~~ — settled at 15 minutes with a 10-minute catch-up
   window, in `REMINDER_LEAD_MINUTES`.
5. **Whether the QR needs rotation** before the next edition, if screenshot
   sharing turns out to happen in practice. Still open; re-pairing already
   rotates it, so the question is only about unprompted rotation.
6. **Whether a cancelled *session* should notify the people booked into it.**
   The one open decision with code behind it rather than a name or a policy.
   Opened 2026-09-01. Today it does not: setting a schedule item to `cancelled`
   sends nothing, and the only way to reach that roster is an urgent
   announcement, which goes to everybody. See the push trigger list in P2D.
