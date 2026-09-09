# Library catalogue in the admin console

2026-09-09

## The problem

Taking a game off the shelf is a pull request.

The tip of `main` when this was written is `258b806`, "Take six games off the
library shelf" — five owners who stopped bringing a game, and one who kept a
copy of Inis at home. Acting on that required editing `src/data/excluded-games.tsv`,
running `npm run sync:library` (a ~1,000-request BoardGameGeek merge), committing
a 175-line diff to `src/data/game-library.json`, running `npm run seed:library`,
opening a PR, and rebuilding the site. Six games leaving a shelf is not a code
change, and nobody without a checkout and a BGC Supabase key can do it.

Everything else REPLAY runs — editions, programme, promos, partners, sponsor
logos, announcements — is edited in the admin console. The game library is the
last thing that still lives in git.

## What changes

`library_titles` becomes the catalogue. Today it is a deliberately thin table —
`key`, `bgg_id`, `title` — because `src/data/game-library.json` owned the
metadata and the migration's own comment warned that copying it into Postgres
"would create a second source of truth that drifts apart on the next
`sync:library`". That warning was correct while the JSON was authoritative. It
dissolves when the table *is* the catalogue, and the drift it warned about is
the thing that made this change necessary.

So the metadata moves onto the row, the committed snapshot is deleted, and a new
admin page edits the table directly.

### What an admin can do

| Action | Effect |
|---|---|
| Take a game off the shelf | Drops off the public page, the app and the desk. Reversible with one click, and the row stays visible in the admin so it can be put back. |
| Add a game by BoardGameGeek id | Paste an id or a BGG URL. The Worker fetches the box — art, player counts, minutes, rating, weight — and shows it for confirmation before saving. |
| Add a title BGG has never heard of | A REPLAY-owned box, a prototype, a local publisher's game. Typed by hand, drawn with the monogram tile the page already uses for art-less cards. |
| Change how many copies are on the shelf | An override that survives the next sync. |
| Link an art-less title to a BGG id | Fixes the "same game, two cards" case. Records an alias so the next sync makes the same match, and merges the orphan card into the real one. |

### Who owns which column

This is the whole design. Every column has exactly one owner, so a sync can
never silently undo an admin's decision and an admin can never be overwritten by
a harvest.

| Owner | Columns |
|---|---|
| `sync:library` | `title`, `year`, `thumb`, `min_players`, `max_players`, `min_time`, `max_time`, `rating`, `weight`, `best_with` — for rows whose `source` is `bgg` or `bgc` |
| The admin | `shelf_status`, `off_shelf_note`, `copies_override`, and *every* column of a row whose `source` is `manual` |
| `sync:descriptions` | `description` |
| Derived | the published copy count — `copies_override`, else the number of `library_copies` rows in circulation |

A `manual` row is never touched by a sync. That is what makes "add a game BGG
does not list" safe: the next harvest cannot delete it.

### What replaces the three data files

- `src/data/excluded-games.tsv` → `library_titles.shelf_status`. An excluded
  game keeps its row instead of vanishing, which is what lets the admin page
  list what is off the shelf and put it back.
- The scoped `<bggId>@<collection>` form → `copies_override`. "This collection
  stopped lending theirs" and "there are two copies, not three" are the same
  fact from the page's side, and the page is the only side that publishes.
  Lender names are deliberately not stored, so the scoped form could never have
  been shown in the admin anyway.
- `src/data/bgc-bgg-ids.tsv` → `library_title_aliases`, read by the sync.
- `src/data/game-library.json` → deleted. Git history keeps it; a copy that
  survives is the drift this is meant to end.

## Who reads the catalogue, and how each one changes

Three consumers, and each needed a different answer.

**The public site** already reads Supabase at build time for editions, sponsors
and the programme. It gains one more read, through a view
(`library_catalogue_public`) granted to `anon` — on-shelf rows only, with the
copy count folded in. Nothing about the shape the page renders changes.

**The attendee app** bundles the catalogue as a static chunk so the library
works on venue wifi and offline. That property is worth keeping, so the app
still bundles it — but a Vite plugin now fetches it at build time and writes
`app/src/generated/game-library.json` instead of importing a committed file.

The app's build has no Supabase credentials and its deploy workflow has no
secrets beyond Cloudflare's, so it reads a new *public* Worker endpoint,
`GET /api/app/catalogue`, rather than gaining a database key. No new GitHub
secret is needed.

A bundled catalogue is stale between app deploys, which matters if a game is
pulled the night before. It is made safe rather than fast: **off-shelf titles are
added to the `unavailable` list** the app already fetches from
`/api/app/library`. A stale bundle therefore shows a withdrawn game greyed out
rather than offering a box that is not in the building.

**The desk** already reads `library_titles`. `request_library_copy` gains one
condition so a copy of an off-shelf title cannot be handed out, and the desk's
title search hides them.

## Deliberate non-goals

- **No name search against BoardGameGeek.** `geeksearch.php` answers 403 to
  anything that is not a browser (verified again on 2026-09-09; per-id lookup
  still answers 200). Adding by id or by pasted URL is what is actually
  possible, so that is what the page offers.
- **`sync:library` stays a manual command.** The BGG collection lists still have
  to be harvested through a real browser, and a ~1,000-request merge does not
  belong in a Worker or a Pages build. It stops writing a file and starts
  writing rows; that is the only change.
- **No image upload.** A manual title gets the monogram tile. Art comes from a
  BGG id, which is also how it works today.
- **Curation is admin-only.** The `library` role runs the desk during the event;
  changing what the public site advertises is a different job.

## Order of operations

The migration adds columns and a view the Worker and the site both read, so it
goes first, and the catalogue has to be backfilled before anything reads the
table instead of the file:

1. apply the migration
2. `npm run migrate:catalogue` — loads the committed JSON, the exclusion file
   and the id overrides into the new columns and tables
3. deploy the Worker
4. deploy the admin
5. merge, which rebuilds the public site and ships the app

Between 1 and 2 the table has the columns and no metadata, so the site must not
be rebuilt in that window. Step 2 is run from a checkout that still has
`src/data/game-library.json` — the PR that deletes it is merged at step 5.
