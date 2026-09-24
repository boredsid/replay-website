# Between editions — build plan

2026-09-24. Design: `docs/specs/2026-09-24-between-editions-design.md`.

Branch `between-editions`, cut from `origin/main` at `48c7425`. The work is in a
scratch worktree under the session scratchpad, not the shared checkout, with
the three `node_modules` directories symlinked in.

The order below is the build order. Each step leaves the tests green. Steps
1–4 can ship before the site changes, because nothing reads them yet.

## 1. Database

`supabase/migrations/<ts>_between_editions.sql`. Check the prefixes in
`supabase/migrations/` first; the newest on `main` is `20260913170000`.

- `alter table editions add column photos_url text`, with the check
  `editions_photos_url_https`: `photos_url is null or photos_url ~ '^https://'`.
- `create function public.edition_recap(p_edition_id uuid) returns jsonb`,
  `language sql stable`. It returns the `attendance`, `sessions` and `library`
  objects from the spec's contract, and nothing else:
  - arrivals: `check_in_events` with `kind = 'in'`, `voids_event_id is null`,
    and no other row whose `voids_event_id` is this row's id. The comment
    names `worker/src/display-feed.ts` as the other copy of this rule.
  - `people` = distinct attendees; `by_day` = distinct per `day`; `both_days` =
    attendees with arrivals on two distinct days.
  - sessions: `session_signups` with `status = 'confirmed'`, joined to this
    edition's `schedule_items`; `by_item` ordered by bookings, highest first.
  - library: `library_loans` with `checked_out_at is not null`; `most_borrowed`
    is the top five by count, ties broken by title, joined through
    `library_copies.title_id` to `library_titles.title`.
- `revoke all on function public.edition_recap(uuid) from public, anon, authenticated;`
  `grant execute … to service_role;`
- **Validate before applying.** Run the function body as a plain query against
  production (read-only) and check it returns 285 / 154 / 185 / 54 / 286 / 38 /
  145 for REPLAY 3. Then apply with the Supabase MCP's `apply_migration`, not
  `execute_sql`; the latter leaves the repository behind the database.

## 2. Worker: the recap endpoint

`worker/src/recap.ts`

- `handleRecap(req, env, slug)`: rate-limit on the caller's IP through
  `PUBLIC_RATE_LIMITER`. Load the edition by slug. Return 404 `not_found`
  unless it is published and `end_date < istDate(new Date())`. Call
  `sb.rpc('edition_recap', { p_edition_id })` and return
  `{ edition: { slug, start_date, end_date }, ...shapeRecap(raw) }` with
  `Cache-Control: public, max-age=300`.
- `shapeRecap(raw)`: pure. Coerces every count to a non-negative integer,
  drops anything not in the contract, and caps `most_borrowed` at five.
- Route in `worker/src/index.ts` beside the other public GETs:
  `/^\/api\/recap\/([a-z0-9-]+)$/`.

`worker/src/recap.test.ts`

- unpublished edition → 404; `end_date` equal to today in Bengaluru → 404; the
  day after → 200.
- `shapeRecap` drops unknown keys, and the response's keys equal the contract
  exactly. This is the test that makes adding a field a deliberate act.
- rpc error → 500, and the error message is not echoed back.

## 3. Worker: the phase cron

- `worker/wrangler.toml`: `crons = ["* * * * *", "30 21 * * *"]`, with a
  comment that the second is 03:00 in Bengaluru and exists only to rebuild the
  site on phase boundaries.
- `worker/src/site-phase-cron.ts`:
  - `phaseBoundary(edition, today): 'live' | 'wrapped' | null`: pure. `today`
    equal to `start_date` is `live`; the day after `end_date` is `wrapped`.
  - `rebuildOnPhaseBoundary(env, sb, now)`: loads `getCurrentEdition(env)`,
    computes `istDate(now)`, and on a boundary calls `fireDeployHook(env)` and
    writes a `site.rebuild` audit row with actor `system:phase-cron` and
    `diff: { reason: 'phase', phase }`.
- `worker/src/admin/rebuild.ts`: extract `fireDeployHook(env): Promise<boolean>`
  so the console button and the cron post to the hook in one place.
- `worker/src/index.ts`: rename `_event` to `controller` and dispatch on
  `controller.cron`. The daily expression runs only the phase check; the
  every-minute one runs the reminders and notices as today.

`worker/src/site-phase-cron.test.ts`

- boundaries, including a month rollover (end `2026-09-30` → `2026-10-01`);
- at 21:30 UTC, `istDate` is already the next day, so a cron at
  `2026-09-13T21:30Z` is the `wrapped` boundary for REPLAY 3;
- no current edition, and a non-boundary day → the hook is not called;
- a hook that fails is logged and does not throw.

## 4. Worker and admin: the album link

- `worker/src/admin/editions.ts`: `readPhotosUrl(value)`, modelled on
  `readGoogleMapsUrl`: https only, host in
  `PHOTO_HOSTS = ['photos.app.goo.gl', 'photos.google.com', 'drive.google.com']`,
  otherwise `invalid_photos_url`. Wire it into create and patch next to
  `google_maps_url`.
- `worker/src/admin/editions.test.ts`: accepts the REPLAY 3 short link and a
  Drive folder link; rejects `http:`, another host, and `javascript:`; a patch
  without the field leaves it alone.
- `admin/src/lib/types.ts`: `photos_url?: string | null` on the edition type.
- `admin/src/pages/EditionDrawer.tsx`: a "Photo album" field in its own small
  section after the visit details, with the hint from the spec. It is empty
  string in the form state and `null` on save.

## 5. Site: the phase model

`src/lib/site-phase.ts`, pure and without I/O:

```ts
export type SitePhase = 'pre_event' | 'live' | 'wrapped' | 'none';
export interface SiteState {
  phase: SitePhase;
  today: string;               // YYYY-MM-DD in Bengaluru
  upcoming: EditionRow | null; // current, published, not ended
  recap: EditionRow | null;    // latest published edition that has ended
}
export function resolveSitePhase(input: {
  current: EditionRow | null; latestEnded: EditionRow | null; today: string;
}): SiteState;
export function siteToday(env = process.env): string; // SITE_TODAY, validated
export function editionNumber(slug: string): number | null; // "replay-3" → 3
export function displayEdition(state: SiteState): EditionRow | null; // upcoming ?? recap
```

- `astro.config.mjs`, at module scope beside the link-preview stamp:
  `process.env.SITE_TODAY ||= <Bengaluru date now>`. The date helper lives in
  `site-phase.ts` and is imported, so the config and the tests use the same
  code.
- `src/lib/data.ts`:
  - `getLatestEndedEdition(today)`: published, `end_date < today`, ordered by
    `end_date` descending, `limit(1)`.
  - `getSiteState()`: memoised for the build; `getCurrentEdition()` plus the
    above, through `resolveSitePhase`.
  - `getEditionRecap(slug)`: memoised; `GET {PUBLIC_WORKER_URL}/api/recap/:slug`.
    Returns `null` and `console.warn`s on any failure. The spec explains why
    this one degrades while the catalogue throws.
  - `getPastEditions(today)`: published and ended, newest first, for `/photos`.
- `src/lib/site-phase.test.ts`: every row of the spec's state table; the event
  days inclusive at both ends (`live`); an empty database (`none`); `SITE_TODAY`
  that is not a date throws; `editionNumber` for `replay-3`, and `null` for a
  slug with no number.

Pages keep calling `getCurrentEdition()` where their `pre_event` behaviour
needs it. `getSiteState()` is added beside it, not in place of it, so nothing
in `pre_event` changes.

## 6. Site: the recap copy

`src/lib/recap.ts`, pure: every copy decision in the spec's "Rules for showing
them", unit-tested without a page.

```ts
export function recapView(input: {
  edition: EditionRow;            // the recap edition
  nextNumber: number | null;      // REPLAY 4
  recap: RecapResponse | null;    // null when the Worker call failed
  programmeCount: number;
  shelfCount: number | null;
  sponsors: SponsorRow[];
  hasAlbum: boolean;
}): RecapView;                    // headline, sub, tiles[], mostBorrowed, fullest,
                                  // credit, links[], lastTimeLine, cheapestBooth
```

`src/lib/recap.test.ts`

- REPLAY 3's real figures produce the mock's band, word for word.
- A REPLAY 2-shaped edition (no app data) gets the fallback headline and no
  zero tiles.
- `recap: null` still produces a headline and the links.
- The credit line with an association sponsor only, a title sponsor only, both,
  and neither; a sponsor with `show_in_header` off is not credited.
- "Most borrowed" is hidden with two titles and shown with three; "Fullest
  session" is hidden with no bookings.
- The both-days sentence is left out for a one-day edition.
- `lastTimeLine` is `null` without a people figure, and has no photos link
  without an album.
- `cheapestBooth` is the lower of `standard_booth` and `community_booth`.

`src/components/RecapBand.astro` renders a `RecapView`: a yellow band, white
stat tiles, the ranked list with bars, and the fullest-session card, as in the
mock. The styles are scoped to the component and build on `global.css`
(`.btn`, `.section-tag`).

## 7. Site: the layout

`src/layouts/Layout.astro`

- `const state = await getSiteState()`.
- `nav`: in `wrapped`, Home · Photos · What was on (`/schedule`) · Game library ·
  Get involved · Contact us. Otherwise, as today.
- Header button: "Get notified" in `wrapped`, "Tickets" otherwise, `/tickets`
  either way. The mobile menu follows.
- `lockup`: `headerLockup(partnerLogos)` only when `state.upcoming` exists.
- Footer: add "Photos" in every phase; drop "Plan your visit" in `wrapped`.

## 8. Site: the sponsor wall

`scripts/normalize-sponsor-logos.ts` picks the wall's edition with the same
rule as the pages. It fetches the current published edition and the latest
ended one over REST, calls `resolveSitePhase` with `siteToday()`, and uses
`displayEdition(state)`. The warning for "no published current edition" becomes
"no edition to show".

`src/components/SponsorsBand.astro` gains an optional `heading` prop. The
homepage passes "REPLAY 3 was made with these 24." in `wrapped`, with the count
from the logo list.

The normaliser is covered by testing `resolveSitePhase` and `displayEdition`;
the REST fetch itself has no new logic.

## 9. Site: the homepage

`src/pages/index.astro`

- In `wrapped`: the hero pill and CTA; `RecapBand` in place of the dates
  band; the sponsors heading; the closing section with `NotifyMeForm`
  (`editionId` is the recap edition, which `/api/lead` accepts and re-attributes
  itself) and the WhatsApp link; no Event JSON-LD.
- In `pre_event`: unchanged, plus `recapView(...).lastTimeLine` under the dates
  band when there is a recap edition.
- `programmeCount` comes from `getScheduleItems(recap.id)` filtered to
  `published`; `shelfCount` from `getLibraryCatalogue()`, already fetched once
  per build.

## 10. Site: the other pages

- `src/pages/tickets.astro`: a `wrapped` branch ahead of the status branches,
  with the copy from the spec and `NotifyMeForm` for the recap edition. It
  never renders `RegisterForm` or the availability section, whatever the
  status says.
- `src/pages/schedule.astro` and `src/components/ScheduleDay.astro`: in
  `wrapped`, the recap edition's items, the "edition has ended" strip, and the
  new heading. `ScheduleDay` gains optional `archived` and
  `bookings: Record<string, number>` props. When archived, "Book on App" is
  replaced by an "N booked" pill if N > 0, and the highest count gets "Most
  booked". The `KIND_LABEL`/`KIND_PILL` maps do not change.
- `src/pages/get-involved.astro`: in `wrapped`, the pitch hero, the three
  figures and the WhatsApp CTA; `#booth-pricing` and `#community-pricing`
  replaced by the shelved card; `#sponsorship` and the process section as
  today.
- `src/pages/plan-your-visit.astro`: in `wrapped`, the holding hero and the
  library section only. `VenueMap` is not rendered.
- `src/pages/contact.astro`: the venue answer uses the recap edition in
  `wrapped`.
- `src/pages/library.astro`: the desk process comes from `displayEdition(state)`.

## 11. Site: `/photos`

- `src/lib/photos.ts`, pure:
  - `albumHost(url): 'google-photos' | 'google-drive' | null`, and a label for
    each;
  - `albumCards(pastEditions, recapEdition)`: the cards newest first, plus
    whether the recap edition needs the "being sorted" card;
  - `readOpenGraph(html): { image?: string; title?: string }`;
  - `coverAtSize(ogImage, 1600, 900)`: rewrites the `=w…-h…` suffix on an
    `lh3.googleusercontent.com` address, and returns `null` for any other
    host.
- `src/lib/album-cover.ts`: `fetchAlbumCover(url)` fetches the album page with
  a non-browser user agent (the short link then redirects straight to
  `photos.google.com/share/…`), reads the cover and returns its address.
  Returns `null` on any failure, for Drive links, or after a 10-second timeout.
  I/O lives here and only here.
- `astro.config.mjs`: `image.remotePatterns` for `https://lh3.googleusercontent.com/**`,
  so `getImage()` downloads the cover once at build and serves it from
  `/_astro/`. The CSP in `public/_headers` does not change, and step 13
  checks that.
- `src/pages/photos.astro`: a hero ("Photos", one line), then one card per
  album: number, dates, venue, the people figure for the recap edition, the
  cover, and the "Open the album on Google Photos ↗" button
  (`target="_blank" rel="noopener noreferrer"`). The "being sorted" card sits
  first when the spec calls for it.
- `src/lib/photos.test.ts`: host detection for the short link, the long
  `photos.google.com/share/…?key=` form and a Drive folder; `readOpenGraph` on
  a synthetic snippet (no copy of Google's page in the repo); the suffix
  rewrite; card order and the holding card.

## 12. Site: the share card

`src/lib/link-preview.ts`: `linkPreviewContent(state, recapView)`. `pre_event`
and `live` behave as now. `wrapped` becomes eyebrow `REPLAY 3`, `when` = `LAST
TIME / 285 PLAYERS / SEP 12–13, 2026`, and `where` = `NEXT / REPLAY 4 / DATES
SOON`. Without a people figure, `when` shows the date range instead. It uses
the existing renderer; `scripts/render-link-preview.ts` does not change.
`src/pages/link-preview.png.ts` passes the state. Extend
`link-preview.test.ts` for both `wrapped` cases.

## 13. Verification

In the worktree:

- root: `npm test`, `npm run test:app`, `npm run check:app`, `npm run build`;
- `admin/`: `npm test`, `npm run build`;
- `worker/`: `npm test`, `npx tsc --noEmit`;
- `npm audit` in the root, `admin/` and `worker/`.

Then build the site as of three dates and check what each one produced:

| `SITE_TODAY` | Expect |
|---|---|
| `2026-09-10` | `pre_event`: the dates band, "Tickets", no recap band. The recap edition is REPLAY 2, which has no people figure, so there is no "Last time" line either; `dist/` matches `main` apart from the new "Photos" footer link. |
| `2026-09-12` | `live`: the same as above. |
| `2026-09-24` | `wrapped`: "285 people came to play." in `dist/index.html`; `/tickets` has no registration form; `/schedule` has "30 booked"; `/plan-your-visit` has no venue map; `/photos` lists REPLAY 3 with a cover in `dist/_astro/`; the header has no "in association with". |

Before the migration and Worker are live, the `wrapped` build runs against a
Worker without `/api/recap`. It should succeed and show the fallback headline,
which tests the degradation path for free. After step 14.2, rebuild and check
the figures.

CSP: serve the `wrapped` build with `npx wrangler pages dev dist` and look in
the console for `violates the following Content Security Policy directive`.
`astro dev` does not apply `_headers`.

Look at each changed page once in both phases, desktop and phone width, and
compare against the mock.

## 14. Rollout

1. Apply the migration (step 1).
2. `git fetch origin && git log --oneline HEAD..origin/main`. If it lists
   anything, rebase first. Then deploy the Worker from the worktree, and check
   `GET https://api.replaycon.in/api/recap/replay-3` returns REPLAY 3's figures
   and `/api/recap/replay-4-nope` returns 404. Check that another team's public
   route still answers, since a Worker deploy replaces the whole Worker.
3. Open the PR. Both Pages projects build on merge. Today is already `wrapped`,
   so the live site changes when this merges.
4. In the console, set REPLAY 3's album to
   `https://photos.app.goo.gl/2oKWtdKCofYAGhUa6` and accept the rebuild. This
   changes live data, so it waits for your go-ahead.
5. Check replaycon.in in the Browser pane: the homepage, `/photos`, `/tickets`,
   `/schedule`, and the share card at `/link-preview.png?v=…`. Social scrapers
   that already fetched the old card need a manual re-scrape.

Rollback: revert the PR. The migration, the endpoint and the cron are inert on
their own.

## 15. Documentation

- Now, in this branch: a `ROADMAP.md` entry for this work under **Open**; the
  deferred items (the Live design, per-edition pages, the attendee app between
  editions) under **Not this edition**; and photos on the page under **Open
  decisions**.
- When it ships: move the entry to `DELIVERED.md`, and append learnings to
  `AGENTS.md`. These cover `SITE_TODAY` as the single "today", why the recap
  degrades, `edition_recap` restating the arrival rule, dispatching on
  `controller.cron`, and the album host allowlist and Open Graph cover.
