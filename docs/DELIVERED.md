# What REPLAY runs on

Everything built and live, and — where it matters — why it is built that way.

This is one of two documents anyone maintains. The other is
[`ROADMAP.md`](ROADMAP.md), for what is not built yet. Dated files under `docs/specs/`,
`docs/implementation/` and `docs/notes/` are write-once records of a moment and
are never revised; do not trust them for current state. `docs/reference/` holds
maintained how-it-works notes for individual subsystems.

**Read the "why" notes before changing something near them.** Each one is a
mistake somebody already made, usually in production, usually at the point
where it was most expensive.

---

## Surfaces

| Surface | Lives at | Deploys by |
|---|---|---|
| Public site (Astro) | `replaycon.in` | push to `main` |
| Admin (React + Vite) | `admin.replaycon.in`, behind Cloudflare Access | push to `main` |
| Attendee app (React + Vite PWA) | `app.replaycon.in` | **`wrangler pages deploy app/dist` — a merge does nothing** |
| Worker (API + cron) | `api.replaycon.in` | `npm run deploy` in `worker/` |

**Deploy order is migration → Worker → Pages.** A Pages build reads Supabase at
build time and fails on a column that does not exist yet.

---

## Public site

The marketing and information surface: programme, tickets, venue, game library,
partners. Server-rendered at build time from Supabase, so **editing data alone
changes nothing until a build runs** — push an empty commit to trigger one.

- **Venue floor plan** — geometry and SVG in `src/lib/venue-map.ts`, zero
  dependencies, shared with the attendee app. The organiser's sketch is the
  source of truth for layout; the CAD sets the outer envelope only. See
  `docs/reference/VENUE_MAP.md`.
- **Game library page** — 586 titles from `src/data/game-library.json`, a
  committed snapshot rebuilt on demand by `npm run sync:library`. BoardGameGeek
  has closed every scriptable read path except per-game enrichment, so the
  collection list is harvested through a real browser and committed. See
  `docs/reference/GAME_LIBRARY.md`.

## Admin

Behind Cloudflare Access. Registrations, editions, users, promo codes,
partners, sponsors, leads, audit log, plus the three event-day screens below.

### Roles and staff (P6, 2026-09-05)

`staff` (email, roles[]) replaced a comma-separated `ADMIN_EMAILS` secret.
Five roles: `admin`, `basic_admin`, `check_in`, `library`, `programme`.

- **`basic_admin` is everything except the staff table.** That is the only
  privilege boundary that matters — a role that can edit staff can grant itself
  every other role.
- **Authorisation is one check in front of all 52 admin routes**, by path
  prefix, in `worker/src/admin/roles.ts`. A route with no rule is admin-only, so
  one added later fails closed rather than open.
- **It is method-aware.** Every member of staff can *read* the programme,
  notices and bookings; only the owning role can write. Bookings read that way
  are redacted — no money at all, phone masked to the last four digits. Every
  money field goes, not only `amount_paid`: leaving the discount would let the
  price be worked out from it.
- **Cloudflare Access is synced from the table**, so adding somebody is one
  screen rather than a dashboard edit plus a Worker deploy. The sync preserves
  rules it did not create and **never writes an object it could not first
  read** — that is how rules get deleted by accident.
- **The last full admin cannot be removed or demoted**, by a database trigger
  rather than application code, so it holds whichever caller is wrong.

> **Cloudflare renamed Access Groups to "Rule groups"** and put them on the same
> screen as reusable policies, under the same `/policies/` URL. An id copied
> from there could be either, so the sync tries both endpoints.
>
> **`Access: Apps and Policies` and `Access: Organizations, Identity Providers,
> and Groups` are different token permissions.** A token with only the second
> gets 403 on a policy.

### Check-in (P2A)

Search by phone, check in per day, undo, bulk, roster CSV, and an offline queue
that replays on reconnect.

> **The rule that matters is enforced in the database**, not the Worker:
> `enforce_check_in_day_purchased()` makes it impossible to check somebody in
> for a day they did not buy, whatever the caller does.
>
> **`check_in_events` is append-only.** Re-entry is a new row and undo is a row
> naming the row it cancels, so every question is answered by folding events.
> **Arrival and presence are different questions** — stepping out for lunch does
> not un-arrive anybody, and conflating them would revoke the ability to book.

### Game library desk (P4)

One screen. Scan a pass — or search by phone for somebody without the app — and
it shows what that person has and offers only the action that follows. Plus the
circulation list, a printable ledger, a CSV, and withdrawn copies with a way
back onto the shelf.

> **Staff never pick a mode.** Choosing between "lend" and "return" is the
> mistake a queue reliably produces.
>
> **Decoding is jsQR, not the native `BarcodeDetector`**, which is Chromium-only
> — an iPhone at the counter would have got no scanner at all.
>
> **`Permissions-Policy: camera=()` disables the camera for your own origin
> too.** Chrome enforces it; iOS Safari does not apply it to `getUserMedia`,
> which is why a scanner can work on a phone and fail on a laptop. The admin
> sets `camera=(self)`; the app and site keep `camera=()`.
>
> **The printed ledger carries no phone numbers** — it sits face-up on a counter
> all day. The CSV does, because chasing a missing game needs one.

## Attendee app

Installable PWA. Works offline once opened; the public half needs no pairing.

**Now / Schedule / My Day / Map / Library**, with the pass in the top bar as a
sheet over whatever you were doing rather than a tab.

### Identity (P2B, P2E, P3)

Kiosk-issued 8-character pairing code. No email, no magic link, no OTP.

> **The QR is minted at pair time**, not when the code is issued — it has to
> reach the attendee's device. Re-pairing rotates it, so a lost phone stops
> borrowing games.
>
> **The gate relaxes outside the event** to "arrived on any day this ticket
> covers". Without it, pairing would first run for real at the door on day one.
> The same relaxation exists for library loans, for the same reason.
>
> **The pass reads its name fresh from the attendee record**, not from the copy
> stored at pairing: the desk can rename a seat afterwards, and a pass reading
> "Guest 2" at a door is worse than none.

### Bookings and waitlist (P2C)

Book a session from the app, join a waitlist, get promoted automatically.

> **`RETURNING` on an `UPDATE` yields the NEW row.** `cancel_session_signup`
> read the pre-update status from it, which made the promotion branch
> unreachable and would have frozen every waitlist silently.
>
> **Capacity is enforced by a row-locking RPC**, not by the Worker, which would
> race exactly when it matters.
>
> Sign-up modes are `('none','app')`. `walk-in`, `advance` and `on-site`
> described nothing the app could act on.

### Game library (P4)

Browse 586 titles with the same filters as the public site, reserve a copy for
five minutes, collect it at the counter.

> **The catalogue is not fetched from the API.** It ships as the same committed
> snapshot the site uses, code-split and loaded on first visit to the tab, so it
> costs nothing for people who never borrow and works when the venue network
> does not. The server is asked only which titles have **nothing free** — a list
> proportional to how many boxes are out, not to the size of the shelf.
>
> **The unit is a copy, not a title.** Three copies of Catan are three
> borrowable things, and a model that counts titles cannot answer "is there one
> left".
>
> **Four rules are partial unique indexes, not application code** — one live
> loan per copy, one live hold per copy, one game at a time per attendee, one
> hold at a time. An index cannot be raced.
>
> **Holds expire lazily.** Nothing sweeps on a timer; the RPCs retire stale rows
> on their way past, so there is no cron that can quietly stop and leave copies
> locked.
>
> **Descriptions are trimmed to 300 characters.** Full BGG text averages ~1,600
> and would take the catalogue chunk from 48KB gzipped to about 300KB, paid on
> first open by everyone.

### Push notifications (P2D)

Hand-rolled Web Push against WebCrypto — Node's `web-push` does not run in
Workers. Cron every minute.

Four triggers, and nothing else:

1. Waitlist promotion, attendee-initiated
2. Waitlist promotion, staff-initiated
3. Urgent or incident announcements, **only on the transition into published**
4. Session reminders, 15 minutes before, to booked **and starred** attendees

> **`ctx.waitUntil` is not optional.** Workers cancel pending work when a
> response returns, so a bare promise means promotions can silently never send.
>
> **Only 404 and 410 prune a subscription.** Everything else increments a
> counter.
>
> **Delivery is at-least-once**; `reminded_at` is what makes a retry safe.
>
> **Reminders cover starred sessions, not only booked ones.** Only 4 of day
> one's 32 published sessions take bookings at all — for the other 28 the star
> is the only way to say "I mean to be there". This reversed an earlier decision
> to keep My Day local: a cron cannot read a phone.
>
> **Routine announcements never buzz anybody.** A channel that fires for
> ordinary news gets switched off before the notice that matters arrives.

---

## Conventions that hold everywhere

- **New tables:** RLS on, `revoke all from anon, authenticated`, minimum grants
  to `service_role`. A bare `grant select, insert` **restricts nothing** —
  Supabase's defaults have already granted the rest, so revoke explicitly.
- **Admin mutations write to `admin_audit_log`**, with `actor_email` from the
  verified Access JWT and never from a request body.
- **Every new HTTP method goes in `CORS_HEADERS`.** The app and API are on
  different origins, so a missing method fails at preflight and surfaces in the
  app as "you are offline". This has happened twice, to `DELETE` and `PUT`.
- Worker handlers are one per file with a colocated `.test.ts`.

## Shipped but never exercised by a human

Honest gaps. All are covered by tests and by nothing else.

- **The library desk screen.** It sits behind Cloudflare Access and will not
  render locally without a JWT, so every button on it — hand over, take back,
  back-but-damaged, mark lost, put back, print ledger — has only ever been
  driven by a test.
- **Non-admin roles.** Twelve people hold them; nobody has signed in as one.
  Thirty role tests are not the same as a volunteer finding a screen missing.
- **The session-reminder push.** Waitlist promotion has reached a real device;
  this has not. Proving it needs the edition dates to be today.
- **Last call and the closing-time cap**, for the same reason: both rules relax
  outside the event.
- **`ADMIN_EMAILS`** is still set as a Worker secret and read by nothing. Left
  so a rollback has somewhere to land; delete it after the event.
