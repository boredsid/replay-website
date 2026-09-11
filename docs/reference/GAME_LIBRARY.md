# Game library (`/library`)

`replaycon.in/library` lists every game on REPLAY's shared shelf, pooled from
five sources, with filters for player count, length and complexity.

**The catalogue lives in `library_titles`, and the admin console edits it.**
Adding a game, taking one off the shelf, correcting a copy count or linking an
art-less title to its BoardGameGeek entry are all done at
`admin.replaycon.in/catalogue` — no checkout, no commit. `npm run sync:library`
still does the heavy BoardGameGeek merge on demand, but it writes to that table
rather than to a committed file, and it is careful never to overwrite a decision
made in the console. See
`docs/specs/2026-09-09-library-catalogue-admin-design.md` for why it moved.

## The five sources

| Source | Where it lives | Refresh |
|---|---|---|
| Bangalore Games Club library | `public.games` on the **bgc-website** Supabase project | Automatic — the sync script reads it every run |
| Added in the console | typed straight into `library_titles`, `source = 'manual'` | Never touched by a sync |
| `Kishore_Rubik` | boardgamegeek.com collection | Manual harvest into `src/data/bgg/Kishore_Rubik.tsv` |
| `Vinto100` | boardgamegeek.com collection | `src/data/bgg/Vinto100.tsv` |
| `DeadlyEvilDevil` | boardgamegeek.com collection | `src/data/bgg/DeadlyEvilDevil.tsv` |
| `ShadowfaxJi` | boardgamegeek.com collection | `src/data/bgg/ShadowfaxJi.tsv` |

## Why the BGG side is a manual harvest

BoardGameGeek closed its public read paths some time before August 2026:

- `boardgamegeek.com/xmlapi2/...` and `api.geekdo.com/xmlapi2/...` answer
  **401** with `WWW-Authenticate: Bearer realm="xml api"`. Session cookies do
  not satisfy it; it wants an API token BGG issues per account.
- `boardgamegeek.com/xmlapi/...` (the v1 API) answers **401** the same way.
- The HTML collection pages answer **403** with `cf-mitigated: challenge` to
  anything that is not a real browser.
- `api.geekdo.com/api/collections?...` answers **400** for every parameter
  shape tried; it is not a usable substitute.

What *does* still answer an ordinary HTTP client, unauthenticated:

- `api.geekdo.com/api/geekitems?objectid=<id>&objecttype=thing&subtype=boardgame`
  — names, year, player counts, play times, box art.
- `api.geekdo.com/api/dynamicinfo?objectid=<id>&objecttype=thing`
  — community rating, weight, and the best-player-count poll.

So per-game **enrichment is automatic**; only the **list of ids** has to come
through a browser. That is what the `.tsv` files hold.

If BGG ever issues the team an API token, the collection fetch can be
automated — the rest of the pipeline already is.

## Re-harvesting a collection

Open the collection in a real browser (a signed-out browser is fine — these are
public collections):

```
https://boardgamegeek.com/collection/user/<username>?own=1&subtype=boardgame&excludesubtype=boardgameexpansion&ff=1
```

Run this in the console and paste the result into
`src/data/bgg/<username>.tsv`, replacing the file:

```js
[...document.querySelectorAll('tr[id^="row_"]')].map((tr) => {
  const a = tr.querySelector('td.collection_objectname a.primary');
  if (!a) return null;
  const id = a.getAttribute('href').match(/\/boardgame(?:expansion|accessory)?\/(\d+)\//);
  const year = tr.querySelector('td.collection_objectname span.smallerfont');
  return [id ? id[1] : '', a.textContent.trim(), year ? (year.textContent.match(/\d{4}/) || [''])[0] : ''].join('\t');
}).filter(Boolean).join('\n')
```

The page shows 300 rows at a time. Check the `N to M of TOTAL` counter above the
table and append `&page=2` (and so on) until you have all of them — the row
count in the file must equal that total.

## Refreshing from the sources

```bash
SUPABASE_SERVICE_KEY=<replay service key> \
BGC_SUPABASE_ANON_KEY=<bgc-website publishable key> \
  npm run sync:library
SUPABASE_SERVICE_KEY=<replay service key> npm run sync:descriptions
```

Both, in that order, every time. `sync:library` re-merges the five sources, and
`description` is not one of the things it knows how to produce — so a bare
`sync:library` run leaves new games blurb-less. `sync:descriptions` fills only
the rows missing one, so running it when nothing is missing costs nothing.

**What a sync may and may not touch** is the rule the whole design rests on,
because the console is now editing the same rows:

| Owner | Columns |
|---|---|
| `sync:library` | `title`, `year`, `thumb`, players, minutes, `rating`, `weight`, `best_with` — and only on rows whose `source` is `bgg` or `bgc` |
| the console | `shelf_status`, `off_shelf_*`, `copies_override`, and **every** column of a `source = 'manual'` row |
| `sync:descriptions` | `description` |
| `sync:library` | every row of `library_title_owners`, rewritten wholesale each run |

A game is identified by `bgg_id` where it has one, falling back to `key`. That
is what lets somebody link a differently-spelled club title to its BGG entry in
the console and have the next sync agree with them rather than making a second
card for it.

Copies are reconciled, never deleted: `service_role` has no `delete` on
`library_copies`, and a loan pointing at a vanished copy would destroy the only
record of who had it. A copy that has left the pooled collections is
**withdrawn** and attributed to `sync:library`, so the desk can tell it from a
box somebody pulled for a missing piece; one that comes back is restored before
any new row is made. A copy out on loan is never withdrawn.

Because the sources are live, a sync also picks up whatever else has moved
since the last one — new BGC rows, a rating nudged by a few votes.

Per-game responses are cached in `scripts/data/bgg-cache/` (gitignored), so a
re-run after editing one `.tsv` costs only the new ids. Delete the cache
directory to force fresh ratings and weights.

Neither key is ever committed. The BGC one comes from the Supabase dashboard
for the `bgc-website` project (or the Supabase MCP `get_publishable_keys`); the
REPLAY service key from REPLAY's own project.

## How the page and the app read it

Neither reads the database. Both read `GET /api/catalogue`, the Worker's one
public projection of `library_titles` — the table sits with `library_copies` and
`library_loans` behind "nothing reaches these except the Worker", and the
catalogue is the only part of that group anybody outside may see.

- The **site** fetches it during `astro build` (`getLibraryCatalogue` in
  `src/lib/data.ts`) and throws rather than building an empty library page.
- The **attendee app** fetches it during its Vite build and bundles the result
  as the virtual module `virtual:game-catalogue`, so the shelf still lists on
  venue wifi and offline.

Both are therefore **stale until they are rebuilt**, which is why removing a
game also makes it *safe* to be stale: `library_unavailable_keys` reports
off-shelf titles, so a phone running last week's bundle shows the game greyed
out rather than offering a box that is not in the building, and
`request_library_copy` refuses it outright.

Changing the shelf does **not** redeploy the app — `src/data/**` is no longer in
`deploy-app.yml`'s watched paths, because the catalogue is not there any more.
Run that workflow by hand to put a changed shelf on people's phones.

## Taking a game off the shelf

In the console: open the game at `admin.replaycon.in/catalogue`, and take it off
the shelf with a reason. The reason is required for the same purpose as the one
on a withdrawn copy — a removal nobody can explain is a removal nobody can
confidently undo — and the row stays visible under the "Off the shelf" filter so
it can be put back with one click.

What that does, immediately: the desk stops offering it and
`request_library_copy` refuses it. What it does at the next rebuild: it leaves
the public page.

The row is kept rather than deleted. That is deliberate and is the main thing
this replaced — `src/data/excluded-games.tsv` listed bare ids that were dropped
before the snapshot was written, so an excluded game had no row anywhere and
putting one back meant remembering it existed.

**"That owner is not bringing theirs, but somebody else still is"** is a copy
count, not a removal. Set the count by hand on the game instead; it survives the
next sync. This replaces the old `<bggId>@<collection>` scoped exclusion. The
console's owner filter shows who lends what, so the count can be set knowing
whose box is missing.

## No lender names are published

The page never says whose copy a game is. `public.games.owned_by` holds real
first names and the BGG sources are personal handles; neither reaches the
browser.

Lenders are tracked *inside* `scripts/sync-game-library.ts` (as `WorkingGame`)
so duplicate copies can be counted, then collapsed to a bare `copies: number`
before the game is written. The script throws if a `lender` key survives into
the published shape, `src/lib/game-library.ts` has no type that can carry one,
and `library_titles` has no column for one — so the page cannot render a name
even by mistake.

The names *are* stored, since 2026-09-11, for the admin console's owner filter —
but only in `library_title_owners` (title, owner, copies), a separate table
that `anon`/`authenticated` cannot read and that no public endpoint touches.
`worker/src/catalogue.test.ts` fails if `loadCatalogue` so much as reads it. It
is per title rather than per copy because the boxes are not labelled: "copy 2
is Siddhant's" would be invented, "Siddhant lends one" is what the sources say.
Keep it a separate table; a column on `library_titles` would be one careless
`select('*')` away from the public page.

Owners are shown by the name people use, not their BGG username.
`library_owner_names` (source name → display name) is applied by the sync
before it writes, so a person lending through both a collection and the club
sheet is one owner. Its rows exist **only in the database** — the repository is
public, and a committed handle-to-name map would publish exactly the link this
section exists to prevent. A new collection therefore needs a row added by SQL
(the migration `20260911140000_library_owner_names.sql` has the statement);
without one, its owner shows as the username until somebody adds it.

The "Where this list comes from" section credits sources without naming them
("Personal collections — 4 collectors pooling their shelves"). If REPLAY ever
wants to credit lenders by name, that is a deliberate change in both the sync
script and the page — not something to restore by accident.

## Box art is loaded from BoardGameGeek, and CSP must allow it

Cards point `<img src>` straight at `https://cf.geekdo-images.com`. The site
ships a strict CSP in `public/_headers`, so that host has to be listed in
`img-src` or every cover is blocked and the grid renders as empty tiles.

**`astro dev` does not apply `public/_headers`.** Neither does `astro preview`.
That file is a Cloudflare Pages feature, so a CSP mistake is invisible in local
development and only appears in production. To test headers locally, build and
serve the output through Wrangler:

```bash
npm run build && npx wrangler pages dev dist --port 4321
```

Then load `/library` and check the console for
`violates the following Content Security Policy directive`. Any change that
adds a third-party image, font, script, or fetch target needs this check.

## Games with no box art

Box art comes from BoardGameGeek, so a game only has a picture if it has a BGG
id. Every entry from a BGG collection has one by definition. BGC rows do not —
`public.games` has no id column — so they get one of:

1. a folded-title match against a game already on the shelf, or
2. a row in `library_title_aliases`, or
3. nothing, and the card draws a monogram tile instead.

Five of ~586 games are in case 3, and all five are titles BoardGameGeek does
not list at all. The console's **No box art** filter is the working list.

**Expansions and RPG items work here, despite not being board games.** The
enrichment endpoints take any BGG thing id: `objecttype=thing&subtype=boardgame`
returns full data for `boardgameexpansion` ids (`Kingdomino: Age of Giants`,
`Scythe: The Wind Gambit`) and even `rpgitem` ids (`Alice is Missing`). The
`subtype` parameter is effectively ignored for lookup, so no special handling
is needed — just paste the expansion's URL.

**To give a game art:** open it in the console and paste its BoardGameGeek
link. That fills in the box, writes a `library_title_aliases` row so the next
harvest reaches the same conclusion, and — if the game is already on the list
under its BGG id — moves this card's copies onto that one and steps this row
aside. Both halves matter: `src/data/bgg/*.tsv` is replaced wholesale when a
collection is refreshed, so a fix made only to a row comes straight back undone.

**There is no search by name, and there cannot be.** `geeksearch.php` answers
403 to anything that is not a browser (re-checked 2026-09-09; per-id lookup
still answers 200), so the console asks for a link instead. To find one, search
from a browser console — and set `objecttype` to match what you are looking
for, because `objecttype=boardgame` silently omits expansions, which is how
several of them sat art-less looking like BGG had never heard of them:

```js
// objecttype: boardgame | boardgameexpansion | rpgitem
fetch('https://boardgamegeek.com/geeksearch.php?action=search&q=' + encodeURIComponent('Santorini') + '&objecttype=boardgame&B1=Go')
  .then((r) => r.text())
  .then((html) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr#row_')]
    .slice(0, 5)
    .map((tr) => {
      const a = tr.querySelector('a.primary');
      return a && a.getAttribute('href') + ' — ' + a.textContent.trim();
    }));
```

**Check the match before adding it.** Common titles return several games —
"Scout" returns four, and only one is the 2019 card game. A wrong id merges two
different games onto one card. The console shows you the box it fetched, with
its art and player counts, before anything is saved; read it.

## How the merge works

`scripts/sync-game-library.ts`:

1. Reads every `.tsv`, collecting unique BGG ids.
2. Enriches each id from the two geekdo endpoints (cached).
3. Builds one card per BGG id, adding a copy per collection that owns it.
4. Reads `public.games` from bgc-website and joins each row onto a card, first
   by a `library_title_aliases` row, otherwise by folded title (`titleKey` in
   `src/lib/game-library.ts` — case, punctuation, accents, spaces and leading
   articles all removed, so `Q.E.` meets `QE`). The console folds with the same
   function, and a test asserts the two agree — if they ever diverged, an alias
   written there would silently never match here.
5. Where a BGC row matches a BGG card, **BGG's numbers win** and BGC only fills
   gaps. The BGC sheet is hand-entered and has known transpositions in it (one
   row records a 3.41 rating against a 7.80 weight), so the script also
   discards any rating above 10 or weight above 5 as miskeyed.
6. BGC rows with no BGG match become their own card with a `title-` key. They
   have no box art; the page draws a monogram tile instead. The script prints
   the list of these on every run — link one in the console to fix it.
7. Per-lender copies are collapsed to a bare count, and the script throws if any
   lender data survives into the published shape.
8. Writes the result to `library_titles`, skipping `source = 'manual'` rows and
   never touching a column the console owns.

**Deduplication is by BGG id.** Every copy of a game — whichever collection it
came from — lands on one card carrying a copy count, so the headline number
counts games rather than boxes. The failure mode is not a false merge but a
*missed* one: a BGC title BGG spells differently becomes a second card. That is
what linking in the console repairs, and why the "no BGG match" list at the end
of every sync is worth reading. A partial unique index on
`(bgg_id) where shelf_status = 'on_shelf'` stops the opposite mistake: two
on-shelf rows can never claim the same game.

## Editing the copy on the page

The page is `src/pages/library.astro`; the filtering island is
`src/components/GameLibrary.tsx`, and all its logic lives in
`src/lib/game-library.ts` (unit-tested in `game-library.test.ts`). The
"How borrowing works" card reads `editions.game_library_process`, the same
column `/plan-your-visit` uses, so the two pages cannot disagree.
