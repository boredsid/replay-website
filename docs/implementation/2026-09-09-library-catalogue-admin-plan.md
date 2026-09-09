# Library catalogue in the admin console — build plan

2026-09-09. Design: `docs/specs/2026-09-09-library-catalogue-admin-design.md`.

Branch `library-catalogue-admin`, worktree `../replay-library-catalogue-admin`.

## 1. Database

`supabase/migrations/<ts>_library_catalogue.sql`

- `library_titles` gains: `year`, `thumb`, `description`, `min_players`,
  `max_players`, `min_time`, `max_time`, `rating`, `weight`, `best_with`,
  `source` (`bgg` | `bgc` | `manual`), `shelf_status` (`on_shelf` |
  `off_shelf`), `off_shelf_note`, `off_shelf_at`, `off_shelf_by`,
  `copies_override`.
- Check constraint: off-shelf implies a note, mirroring
  `library_copies_withdrawn_has_reason` — a removal nobody can explain is a
  removal nobody can confidently undo.
- `library_title_aliases (folded_title pk, bgg_id, note)`.
- View `library_catalogue_public`: on-shelf rows, published columns only, with
  `copies` = `coalesce(copies_override, count(available copies))`. Granted
  `select` to `anon`; base tables stay revoked.
- `request_library_copy` gains `and t.shelf_status = 'on_shelf'`.
- Grants: `service_role` only on the new tables, as elsewhere.

## 2. Backfill

`scripts/migrate-catalogue.ts`, `npm run migrate:catalogue`, `--apply` to write.

Reads `src/data/game-library.json` → metadata onto matching `key` rows;
`src/data/bgc-bgg-ids.tsv` → aliases; `src/data/excluded-games.tsv` → off-shelf
rows, enriching the plain-id entries from BGG so they have a title to show, and
turning scoped `@collection` entries into a `copies_override` one lower than the
count the sync would compute. Idempotent.

## 3. Worker

- `worker/src/admin/catalogue.ts` — list, patch (shelf status, copies override,
  manual fields), create (by BGG id, or manual), link-to-BGG (alias + merge),
  and a `lookup` that fetches one id from the two geekdo endpoints. Audited via
  `writeAudit` like every other admin mutation.
- `worker/src/bgg.ts` — the two geekdo calls and the response mapping, shared by
  lookup and create. No name search: `geeksearch.php` is 403 to non-browsers.
- `worker/src/app-catalogue.ts` — public `GET /api/app/catalogue`, the shape the
  app bundles. Cached at the edge.
- `worker/src/app-library.ts` — add off-shelf title keys to `unavailable`.
- `worker/src/admin/library.ts` — desk title search hides off-shelf titles.
- `worker/src/admin/roles.ts` — `/api/admin/catalogue` is admin-only.

## 4. Admin SPA

- `admin/src/pages/Catalogue.tsx` — the list: search, filters (on/off shelf, no
  art, no BGG id, manual), copy counts, and the row actions.
- `admin/src/pages/CatalogueDrawer.tsx` — one game: metadata, shelf status with
  its note, copies override, link-to-BGG.
- `admin/src/pages/CatalogueAddDrawer.tsx` — paste a BGG id or URL and confirm
  the fetched box, or add a manual title.
- `admin/src/components/nav.ts` — a `Catalogue` item, admin-only (no `roles`).
- Routes in `App.tsx`.
- CSP: `admin/public/_headers` needs `cf.geekdo-images.com` in `img-src` for the
  box art, the same addition the public site needed.

## 5. Site and app

- `src/lib/data.ts` — `getLibraryCatalogue()` from the view.
- `src/pages/library.astro` — read it instead of importing the JSON.
- `app/vite.config.ts` — a plugin fetching `/api/app/catalogue` into
  `app/src/generated/game-library.json` at `buildStart`; throws on a build,
  warns and writes an empty catalogue in dev.
- `app/src/App.tsx` — import the generated file.
- `.github/workflows/deploy-app.yml` — drop `src/data/**` from the watched
  paths, add `app/vite.config.ts`.

## 6. Delete

`src/data/game-library.json`, `src/data/excluded-games.tsv`,
`src/data/bgc-bgg-ids.tsv`, `scripts/seed-game-library.ts` (folded into the
sync), and the `seed:library` script entry.

## 7. Rewrite the sync

`scripts/sync-game-library.ts` keeps the harvest and the merge and changes only
its destination: upsert sync-owned columns, reconcile `library_copies` to the
effective count (adding only — a copy with loan history is never deleted), and
report the same warnings it reports today (aliases that matched nothing,
overrides that now equal the computed count, BGC titles with no BGG match).

`scripts/sync-descriptions.ts` writes `description` to the table.

## 8. Verify

Root tests + build, admin tests + build, worker tests + typecheck, app tests +
typecheck. CSP checked through `wrangler pages dev dist` for both the site and
the admin, since `_headers` is invisible to `astro dev`.

## Status

- [x] 1 database — applied to production 2026-09-09
- [x] 2 backfill — loaded; 581 on the shelf, 11 off it, Inis pinned to one copy
- [x] 3 worker — deployed, `GET /api/catalogue` serving 581 games
- [x] 4 admin — built and tested, deploys on merge
- [x] 5 site and app — both build against the live endpoint
- [x] 6 delete
- [x] 7 sync
- [x] 8 verify

### What the numbers came out at

581 games on the shelf, 863 copies, 576 with box art and a blurb. Five on-shelf
titles have no art, and they are the same five the reference doc already named:
club games BoardGameGeek does not list at all.

Two things worth recording, both found by doing it rather than by planning it:

- `plan-your-visit.astro` imported the snapshot too, for its "550+ games"
  claim. Nothing pointed at it — an earlier grep for the filename had been
  truncated by a `head` — and the site build was what found it.
- `library_titles` held 586 rows against the retired snapshot's 584, because
  five of the eleven excluded games still had rows from `seed:library` and two
  more had left the collections since. The exclusions are now off the shelf
  either way; `sync:library` reconciles the rest on its next run.
