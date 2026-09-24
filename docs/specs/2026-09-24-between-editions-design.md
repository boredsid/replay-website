# Between editions

2026-09-24

## The problem

REPLAY 3 ended on 13 September. Eleven days later replaycon.in still presents
it as an event people can go to:

- The homepage dates band announces "Sep 12 – Sep 13" with a "Get ticket
  updates" button, and its closing section says **Save the date** above a date
  that has passed.
- `/schedule` shows the whole programme in the present tense, with "Book on
  App" labels for sessions that are over.
- `/plan-your-visit` gives directions, entrance and parking for a terrace that
  is no longer REPLAY's. It is the one page that could send somebody somewhere
  on the wrong day.
- `/get-involved` lists live booth prices with Book buttons. The Worker refuses
  the sale (`partner_sales_closed`, `worker/src/partner-purchase.ts`), but only
  after the partner has filled in the whole form.
- `/tickets` says "Ticket sales for this edition are closed", which reads like
  a missed deadline, not an event that happened.
- The header still credits Meeple Syrup as REPLAY's association partner.
- The Event JSON-LD still reports `EventScheduled` with a `PreOrder` offer, and
  every share of the link still shows the REPLAY 3 dates.

The cause is structural. Every page asks `getCurrentEdition()` and branches on
`registration_status`, which an admin sets by hand. Nothing on the site reads
the dates. And because the site is a static build, even a page that did read
them would change only when something rebuilt it.

A second, latent problem sits next to it. A database trigger
(`20260817170324_fundamentals_hardening.sql`) clears the previous edition's
`is_current` whenever another edition is marked current, and
`getCurrentEdition()` returns only an edition that is **both** current and
published. So the moment an admin marks a draft REPLAY 4 current to start
setting it up, the site has no edition at all. It falls into its "no edition"
branches: no dates band on the homepage, and a Tickets page with no way to
leave a number.

The backend is already mostly honest. Registration refuses unless the status
is `open`, and partner purchases refuse after `end_date`. Registration
does not check the dates; that gap is tracked as its own task, separate from
this design.

## Who the site is for between editions

In season, the site's audience is people buying tickets. Between editions, it
is three other people:

- **A partner deciding next year's budget.** This is when sponsor and booth
  conversations for the next edition happen.
- **Somebody who has just heard of REPLAY** and is checking it is real.
- **The community, waiting for dates.**

All three want proof, not a countdown. REPLAY has more proof than most
conventions, because the attendee app recorded the weekend: check-ins, session
bookings, library loans. The recap is a query, not a piece of writing.

## Decisions

Taken 2026-09-24, after the mock (claude.ai artifact "REPLAY Between Editions").

1. **The programme survives as a record** at `/schedule` while the site is
   between editions.
2. **The recap is a numbers band**, computed from the database. A long-form
   recap page is not in this plan; the photos page (6, below) covers the need
   for pictures.
3. **The dates decide the phase**, and a nightly Worker job rebuilds the site on
   the mornings a phase changes. Nobody has to remember to flip anything.
4. **Get involved makes a real off-season pitch** built on the last edition's
   numbers, routes partners to a WhatsApp conversation, and shelves
   self-serve checkout until the next edition has dates and prices.
5. **The header credit moves into the recap.** "In association with Meeple
   Syrup" was sold for REPLAY 3; between editions it appears as "REPLAY 3 was
   made in association with Meeple Syrup."
6. **Editions carry a photo album link**, and a `/photos` page shows each past
   edition's album. Added at the organiser's request the same day.

## The phase model

Two editions matter at any moment. Both are computed from published editions
and today's date in Bengaluru:

- **The upcoming edition** is the current, published edition, provided its
  `end_date` is today or later.
- **The recap edition** is the most recent published edition whose `end_date`
  is before today, whether or not it is current.

From those, the site is in one of four phases:

| Phase | When | What the site does |
|---|---|---|
| `pre_event` | an upcoming edition exists, and today is before its `start_date` | Exactly what it does today, driven by `registration_status` (upcoming, open, sold out, closed). |
| `live` | an upcoming edition exists, and today is one of its event days | Same as `pre_event` in this plan. The Live design is on the roadmap. |
| `wrapped` | no upcoming edition, but a recap edition exists | Everything in this spec. |
| `none` | neither | The existing "no edition" branches. Only reachable on an empty database. |

Walking the next edition through it:

| REPLAY 3 | REPLAY 4 | Phase | Site shows |
|---|---|---|---|
| current, published, ended | doesn't exist | `wrapped` | REPLAY 3 recap |
| current, published, ended | draft: not published, not current | `wrapped` | REPLAY 3 recap |
| not current (the trigger cleared it) | current, **not published** | `wrapped` | REPLAY 3 recap. Today's code shows the empty "no edition" state here. |
| not current | current, published, `upcoming` | `pre_event` | REPLAY 4's dates, with a "Last time" line for REPLAY 3 |
| not current | current, published, `open` | `pre_event` | REPLAY 4 on sale, with the same line |

What this means for admins:

- Nobody needs to set a finished edition to `closed`; its dates already say it
  is over.
- Nobody needs to un-mark it as current.
- REPLAY 4 can be drafted, priced and dated in any order. The site stays on the
  REPLAY 3 recap until REPLAY 4 is both published and current, then changes on
  the next rebuild. The Edition drawer already asks "Rebuild the site?" on save.

**"Today" is fixed once per build.** `astro.config.mjs` sets
`process.env.SITE_TODAY` at module scope to the Bengaluru date, unless it is
already set. Every page and the sponsor-logo normaliser read that one value,
so a build that runs across midnight cannot contain two phases. Setting
`SITE_TODAY` by hand builds the site as of any date, which is how both phases
are checked locally. This mirrors the link-preview version stamp, set at module
scope for the same reason.

## Each page, by phase

`pre_event` and `live` are unchanged except where noted.

| Surface | `pre_event` | `wrapped` |
|---|---|---|
| Header | Sponsor lockup as today | No lockup. Nav: Home · Photos · What was on · Game library · Get involved · Contact us. Orange button "Get notified" → `/tickets`. |
| Footer | Adds "Photos" | Adds "Photos", drops "Plan your visit" |
| Home hero | Unchanged | Pill "REPLAY 4 · dates coming". CTA "Hear about REPLAY 4 first →" → `/tickets` |
| Home dates band | Unchanged, plus a "Last time" line when a recap edition exists | Replaced by the recap band |
| Home stripes | Unchanged | Unchanged |
| Home partner wall | The upcoming edition's sponsors | The recap edition's sponsors, headed "REPLAY 3 was made with these 24." |
| Home closing | Unchanged | "Save a seat at the next table." with the notify form inline and a WhatsApp link |
| Home JSON-LD | Event, as today | Omitted. There is no event to describe. |
| `/tickets` | Unchanged | "The next one's being planned." with the notify form. Never the registration form, never live availability. |
| `/schedule` | Unchanged | The record: an "edition has ended" strip, heading "What was on.", booked counts in place of "Book on App", a "Most booked" badge |
| `/photos` | Always built | Always built; in the header nav only while `wrapped` |
| `/get-involved` | Unchanged | The off-season pitch (below) |
| `/plan-your-visit` | Unchanged | "Back with REPLAY 4." Arrival, map, venue guide and help sections removed; the library section stays; not in the nav |
| `/contact` | Unchanged | The venue answer turns past tense: "REPLAY 3 was at Indiqube Symphony, MG Road. REPLAY 4's venue is announced with its dates." |
| `/library` | Unchanged | Unchanged. The desk process text comes from the upcoming edition, or the recap edition if there is none. |
| Share card | Unchanged | `LAST TIME / 285 PLAYERS / SEP 12–13, 2026` and `NEXT / REPLAY 4 / DATES SOON` |

**Naming.** These strings say "REPLAY 3" and "REPLAY 4", numbered from the
edition slug; the next edition is the recap number plus one. Elsewhere the site
says "3rd edition" (`editionOrdinal`). "Hear about the 4th edition first" reads
badly in a button, so these phrases use numbers. Both come from the same slug,
so they cannot disagree.

### Get involved, off-season

- Hero: "Put your table in front of Bangalore's players." Three figures from
  the recap edition: people, session seats booked, partners on the floor.
- Primary CTA: "Talk to us on WhatsApp →", through `whatsappContactUrl`.
- The booth and community-engagement pricing sections, and their checkout
  forms, are replaced by one card: "Booths and engagements go back on sale with
  REPLAY 4's dates. For reference, REPLAY 3 booths started at ₹6,500 + GST",
  the lower of the recap edition's two booth prices.
- The sponsorship ladder and the "how partnering works" section stay. They
  already say "ask about the next edition".

## The recap

### Figures and where each comes from

| Figure | Source | Why there |
|---|---|---|
| People through the door | distinct attendees with a non-voided `in` check-in | Worker, because `check_in_events` is private |
| People per day, and "came both days" | same, per `day`, and attendees with arrivals on both days | Worker |
| Seats booked, sessions booked | confirmed `session_signups` | Worker |
| Bookings per session | confirmed `session_signups`, grouped | Worker |
| Games borrowed, most borrowed (top five) | `library_loans` with `checked_out_at` | Worker |
| Things on the programme | published `schedule_items` | Site, which already reads them |
| Games on the shelf | `GET /api/catalogue`, already fetched at build | Site |
| Partners on the floor | the recap edition's `sponsors` rows | Site, which already reads them |

REPLAY 3's figures on 24 September: 285 people (154 Saturday, 185 Sunday, 54
came both days), 69 programme items, 286 seats booked, 145 games borrowed
(Hot Streak 7, Skull 6, Trio 6, boop. 5, Magical Athlete 5), 585 games on the
shelf, 24 partners.

"People through the door" uses the floor display's definition of an arrival
(`worker/src/display-feed.ts`): an `in` event that is not itself a void and
has not been voided by another event. Session bookings count `confirmed` only.
Of 459 sign-up rows for REPLAY 3, 157 were cancelled and 16 still waitlisted.

### Rules for showing them

- **A figure that is zero or missing is left out, not shown as 0.** REPLAY 1
  and 2 were imported from spreadsheets before the app existed and have no
  check-ins, bookings or loans.
- The headline is "285 people came to play." when there is a people figure,
  and "That was REPLAY 2." when there is not.
- "54 of them came both days" appears only for a two-day edition with arrivals
  on both days.
- "Most borrowed" needs at least three titles; "Fullest session" needs at least
  one booking.
- The credit line names the recap edition's `title` and `association` sponsors
  that have `show_in_header` set: "Presented by X", "Made in association
  with Y". With neither, there is no credit line.
- The band's links: "Get REPLAY 4 dates first →" (`/tickets`), "See the
  photos →" when the recap edition has an album, and "What was on →"
  (`/schedule`).
- During `pre_event`, the same data gives one line under the new dates: "Last
  time, 285 people came to play at REPLAY 3. See the photos →". The line needs
  a people figure, and the link appears only when there is an album.

### `GET /api/recap/:slug`

A public Worker endpoint. The site calls it once per build.

```json
{
  "edition": { "slug": "replay-3", "start_date": "2026-09-12", "end_date": "2026-09-13" },
  "attendance": { "people": 285, "by_day": { "day1": 154, "day2": 185 }, "both_days": 54 },
  "sessions": {
    "seats_booked": 286,
    "sessions_booked": 38,
    "by_item": [{ "schedule_item_id": "…", "booked": 30 }]
  },
  "library": {
    "loans": 145,
    "most_borrowed": [{ "title": "Hot Streak", "loans": 7 }]
  }
}
```

`sessions_booked` counts sessions with at least one confirmed booking: 38 for
REPLAY 3. The mock's 39 counted any sign-up row, cancelled ones included.

- **404 unless the edition is published and its `end_date` is before today in
  Bengaluru.** Drafts and editions still in progress have no public recap.
- **Aggregates only.** No names, phone numbers, attendee ids or game owners.
  A test asserts the exact set of keys, so a new field is a deliberate change.
- `Cache-Control: public, max-age=300`, and rate-limited per IP through
  `PUBLIC_RATE_LIMITER`, like the other public routes.
- **The counting happens in Postgres**, in a function
  `edition_recap(uuid) returns jsonb` that only `service_role` can execute.
  PostgREST caps a select at 1,000 rows. REPLAY 3 produced 370 check-in events
  and 459 sign-up rows, so a larger edition would pass the cap, and counting
  rows in the Worker would then undercount without any error. The SQL arrival
  rule restates the one in `display-feed.ts`; each carries a comment pointing
  at the other.

### When the recap cannot be fetched

The build carries on without the figures. The band shows "That was REPLAY 3"
and its links, and the build log warns.

This is deliberately the opposite of the catalogue and the sponsor normaliser,
which stop the build. The rebuild on the morning after an edition is what moves
the site between phases, and a failed Pages build leaves the previous
deployment live. Stopping the build over a recap would leave the site
advertising a finished event, which is the problem this work exists to fix.

## Photos

### The album link

- New column `editions.photos_url text`, nullable, with a check that it starts
  with `https://`.
- The Worker's admin editions handler accepts only these hosts:
  `photos.app.goo.gl`, `photos.google.com` and `drive.google.com`. Anything
  else is rejected as `invalid_photos_url`. The button label ("Google Photos"
  or "Google Drive") comes from the host, and the allowlist is what keeps that
  label true. Widening it is one line.
- The Edition drawer gains a "Photo album" field with the hint: "A Google
  Photos shared-album link, or a Google Drive folder shared with anyone who has
  the link." It is editable on past editions too, so REPLAY 1 and 2 can have
  their albums added.
- The column is public through the existing `editions_public_read` policy. It
  is a link people are meant to follow.

### What the page can show, tested on REPLAY 3's album

Tested on 2026-09-24 against the REPLAY 3 album
(`photos.app.goo.gl/2oKWtdKCofYAGhUa6`):

- **It cannot be embedded.** photos.google.com answers
  `x-frame-options: SAMEORIGIN`.
- **It cannot be read through Google's API.** Since 31 March 2025 the Photos
  Library API manages only media an app uploaded itself, and the shared-album
  endpoints return 403. Google's replacement, the Picker API, needs a signed-in
  user choosing photos, which a public page has no way to provide.
- **It does publish a cover.** The album page's Open Graph tags, the same ones
  WhatsApp reads to preview the link, carry the album's title and a cover image
  on `lh3.googleusercontent.com`. The cover comes back at 1600×900 by changing
  the size suffix, and for REPLAY 3 it is a real photo from the terrace. The
  short link redirects to the full album address for any client that is not a
  browser, which is what a build is.

The album page also embeds the address of every photo in it (about 300 for
REPLAY 3) for Google's own viewer. Reading that would put the whole album on
the page, but it is an undocumented internal format, and it would break without
warning whenever Google changed it. This plan does not use it.

Google Drive folders can technically be embedded, or listed with an API key.
Both are rejected: the page would behave differently depending on which kind of
link an admin pasted, embedding puts Google's file browser inside the site, and
hotlinked Drive thumbnails get throttled.

### `/photos`

- One page, always built. It lists every published, ended edition that has an
  album, newest first.
- Each edition is one large card: "REPLAY 3", dates, venue, the people figure
  when the recap has one, the album's cover photo, and a button "Open the album
  on Google Photos ↗" that opens in a new tab.
- **The cover is copied at build time.** For a Google Photos link, the build
  follows the link, reads `og:image`, asks for the 1600×900 size, and passes it
  through Astro's image pipeline. The page serves it from replaycon.in, so the
  site's CSP needs no new image host, and Google sees one request per build
  rather than one per visitor. Drive links have no meaningful cover and are not
  fetched. Any failure means a card without a cover and a warning in the build
  log, never a failed build.
- The cover is whatever the album owner chose as its cover in Google Photos. To
  change it on the site, change it there and rebuild.
- If the recap edition has no album yet, the page opens with a card: "REPLAY 3's
  photos are being sorted", with the notify form and the WhatsApp link.
- With no albums at all, that holding card is the whole page.
- Linked from the header nav while `wrapped`, from the footer always, and from
  the recap band and the "Last time" line when the recap edition has an album.
- **A shared album is public to anyone with the link.** Putting the link on the
  site makes that literal. What goes in the album, and whether the people in it
  are comfortable being there, is the organisers' call; the site adds nothing
  beyond the link and the cover the album already shows to anyone it's shared
  with.

### Not in this plan: photos on the page

If you want photos displayed on replaycon.in rather than linked, admins would
upload a selection (twelve to twenty-four per edition) in the console. That
means a storage bucket `edition-photos` and a table `edition_photos`, with
Astro optimising the images at build like any local image. `/photos` would
then show a grid with a lightbox above each album button. The homepage photo
band would draw from the recap edition's selection, so REPLAY 2's photos would
stop being the face of the site without anybody remembering to swap them. This
is the same shape as the sponsor-logo upload, and roughly as much work as the
rest of this plan. It is recorded in the roadmap as an open decision.

## Rebuilds

A second cron trigger, `30 21 * * *` (03:00 in Bengaluru), sits beside the
existing every-minute one. The `scheduled` handler dispatches on
`controller.cron`. On the daily run:

- Load the current, published edition.
- If today in Bengaluru is its `start_date`, or the day after its `end_date`,
  POST the existing `CLOUDFLARE_PAGES_DEPLOY_HOOK` and write a `site.rebuild`
  audit row with actor `system:phase-cron`.
- Otherwise do nothing.

That is two rebuilds per edition. Cron delivery is at least once, so a second
rebuild on the same morning is possible, and harmless. The start-date rebuild
changes nothing visible in this plan; it is there so the Live phase needs no
change to the Worker. A failed hook call is logged, not retried. The next
morning's run does not retry either, because the date condition no longer
matches, so a failure shows in the Worker logs and is fixed with the console's
Rebuild button.

## Not in this plan

Each of these gets a roadmap entry.

- **The Live phase design.** On the event days the site behaves as it does
  today.
- **Permanent per-edition pages** (for example `/editions/replay-3`). In this
  plan the programme record lives at `/schedule` only until the next edition is
  announced; after that, the recap survives as the "Last time" line and the
  album survives on `/photos`.
- **Photos on the page**, as described above. An open decision.
- **A partner wall for a new edition with no sponsors yet.** The wall hides
  itself, as it does today; it does not fall back to the previous edition's
  partners.
- **The attendee app between editions.**
- **Refusing registrations for an edition that has ended.** A separate task.

## Order of deployment

1. Migration: `photos_url` and `edition_recap`.
2. Worker: the recap endpoint, the phase cron, and `photos_url` validation.
   Fetch first and deploy from a tree that contains everything on `main`.
3. The site and admin PR. Both Pages projects build on merge. Because today is
   already `wrapped`, merging changes the live site immediately.
4. Add REPLAY 3's album in the console and rebuild.

Rollback is reverting the site PR. The migration, the endpoint and the cron do
nothing on their own; the cron only rebuilds whatever is on `main`.
