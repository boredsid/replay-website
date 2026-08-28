# Game library (`/library`)

`replaycon.in/library` lists every game on REPLAY's shared shelf, pooled from
five sources, with filters for player count, length and complexity.

## The five sources

| Source | Where it lives | Refresh |
|---|---|---|
| Bangalore Games Club library | `public.games` on the **bgc-website** Supabase project | Automatic — the sync script reads it every run |
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

## Rebuilding the snapshot

```bash
BGC_SUPABASE_ANON_KEY=<bgc-website publishable key> npm run sync:library
```

This writes `src/data/game-library.json`, which **is committed** — the site
reads it at build time and never calls BGG or the BGC database during a build.
That keeps Cloudflare Pages deploys fast and immune to a third party's
downtime.

Per-game responses are cached in `scripts/data/bgg-cache/` (gitignored), so a
re-run after editing one `.tsv` costs only the new ids. Delete the cache
directory to force fresh ratings and weights.

The key is read from the environment and must never be committed. Get it from
the Supabase dashboard for the `bgc-website` project, or via the Supabase MCP
`get_publishable_keys`.

## No lender names are published

The page never says whose copy a game is. `public.games.owned_by` holds real
first names and the BGG sources are personal handles; neither reaches the
browser.

Lenders are tracked *inside* `scripts/sync-game-library.ts` (as `WorkingGame`)
purely so duplicate copies can be counted, then collapsed to a bare
`copies: number` before the snapshot is written. The script throws if a
`lender` key survives into the published shape, and `src/lib/game-library.ts`
has no type that can carry one — so the page cannot render a name even by
mistake. `src/data/game-library.json` is served verbatim, so a leak there is a
leak in public.

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
2. an entry in `src/data/bgc-bgg-ids.tsv`, or
3. nothing, and the card draws a monogram tile instead.

As of the current snapshot, 5 of 586 games are in case 3, and all five are
titles BoardGameGeek does not list at all.

**Expansions and RPG items work here, despite not being board games.** The
enrichment endpoints take any BGG thing id: `objecttype=thing&subtype=boardgame`
returns full data for `boardgameexpansion` ids (`Kingdomino: Age of Giants`,
`Scythe: The Wind Gambit`) and even `rpgitem` ids (`Alice is Missing`). The
`subtype` parameter is effectively ignored for lookup, so no special handling
is needed — just put the id in the override file.

This matters because the *search* recipe below is not so forgiving. Searching
with `objecttype=boardgame` silently omits expansions, which is how several of
them sat art-less for a while looking like BGG had never heard of them. Search
the matching object type, or take the id straight out of a BGG URL:
`boardgamegeek.com/boardgameexpansion/240909/kingdomino-age-of-giants` → `240909`.

To give a game art, add a `title <TAB> bggId` row to
`src/data/bgc-bgg-ids.tsv` and re-run the sync. To find an id by name, search
from a browser console (the search page is Cloudflare-gated to scripts, same as
everything else) — and set `objecttype` to match what you are looking for:

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
"Scout" returns four, and only one is the 2019 card game. A wrong id silently
merges two different games into one card.

## How the merge works

`scripts/sync-game-library.ts`:

1. Reads every `.tsv`, collecting unique BGG ids.
2. Enriches each id from the two geekdo endpoints (cached).
3. Builds one card per BGG id, adding a copy per collection that owns it.
4. Reads `public.games` from bgc-website and joins each row onto a card, first
   by an explicit `src/data/bgc-bgg-ids.tsv` override, otherwise by folded
   title (`titleKey` in `src/lib/game-library.ts` — case, punctuation, accents,
   spaces and leading articles all removed, so `Q.E.` meets `QE`).
5. Where a BGC row matches a BGG card, **BGG's numbers win** and BGC only fills
   gaps. The BGC sheet is hand-entered and has known transpositions in it (one
   row records a 3.41 rating against a 7.80 weight), so the script also
   discards any rating above 10 or weight above 5 as miskeyed.
6. BGC rows with no BGG match become their own card with a `title-` key. They
   have no box art; the page draws a monogram tile instead. The script prints
   the list of these on every run — add an id override to fix one.
7. Per-lender copies are collapsed to a bare `copies` count, and the script
   throws if any lender data survives into the published shape.

**Deduplication is by BGG id.** Every copy of a game — whichever collection it
came from — lands on one card carrying a copy count, so the headline number
counts games rather than boxes. The failure mode is not a false merge but a
*missed* one: a BGC title BGG spells differently becomes a second card. That is
what the override file exists to repair, and why the "no BGG match" list at the
end of every sync is worth reading.

## Editing the copy on the page

The page is `src/pages/library.astro`; the filtering island is
`src/components/GameLibrary.tsx`, and all its logic lives in
`src/lib/game-library.ts` (unit-tested in `game-library.test.ts`). The
"How borrowing works" card reads `editions.game_library_process`, the same
column `/plan-your-visit` uses, so the two pages cannot disagree.
