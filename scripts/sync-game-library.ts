// Rebuilds the game catalogue in `library_titles` from the five sources
// REPLAY's shelf is drawn from:
//
//   1. `public.games` on the bgc-website Supabase project (the club library)
//   2..5. Four BoardGameGeek collections, harvested into `src/data/bgg/*.tsv`
//
// Run with `npm run sync:library`. Deliberately NOT wired into `astro build`.
//
// Why the merge is not run at build time:
//
//   * BoardGameGeek closed its public APIs. `xmlapi2` now answers 401 with
//     `WWW-Authenticate: Bearer realm="xml api"`, and the HTML collection
//     pages sit behind a Cloudflare interstitial. Only `api.geekdo.com`, used
//     below for per-game detail, is still open to a plain HTTP client — and
//     nothing guarantees it stays that way.
//   * Even if it were open, ~700 games is ~1400 requests. Hanging that off
//     every Cloudflare Pages build would make deploys slow and, worse, make a
//     third party's downtime able to fail a deploy that has nothing to do with
//     the library.
//
// So the network work happens here, on demand, and the database holds the
// result. It used to be a committed JSON file; it moved into Postgres so the
// admin console could edit it, because taking six games off the shelf on
// 2026-09-09 took a pull request. See
// docs/specs/2026-09-09-library-catalogue-admin-design.md.
//
// What this run may and may not touch is the one rule that matters. It writes
// BoardGameGeek metadata, reconciles physical copies, and records who lends
// each game in the private `library_title_owners`. It never writes
// `shelf_status`, `off_shelf_*` or `copies_override` — those belong to whoever
// is using the admin console — and it skips rows whose `source` is 'manual'
// entirely. Nothing here deletes anything.
//
// Refreshing the BGG side: the `.tsv` files are the harvest, one row per game
// as `bggId<TAB>title<TAB>year`. They come from the collection page's table
// and have to be re-harvested through a real browser when a collection
// changes — see docs/reference/GAME_LIBRARY.md. Everything downstream of them, and the
// whole BGC side, is automatic.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { titleKey, titleSlug, type LibraryGame, type LibrarySourceSummary } from '../src/lib/game-library.ts';
import { ownerRows, type OwnerRow } from './lib/library-owners.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const collectionsDir = join(repoRoot, 'src/data/bgg');

/** Gitignored (all of `scripts/data/` is). Makes a re-run cost no requests. */
const cacheDir = join(repoRoot, 'scripts/data/bgg-cache');

/**
 * The BGC club library lives on its own Supabase project, separate from
 * replay-website's. `public.games` carries a `USING (true)` select policy for
 * `anon`, so the publishable key is all this needs — and the key is only ever
 * read from the environment, never committed.
 */
/**
 * REPLAY's own project, where the catalogue now lives. The service key is
 * exported for the command and never written to a file, same as seed scripts.
 */
const replayEnv = { ...loadEnv('production', repoRoot, ''), ...process.env };
const REPLAY_URL = replayEnv.PUBLIC_SUPABASE_URL?.trim();
const REPLAY_SERVICE_KEY = replayEnv.SUPABASE_SERVICE_KEY?.trim();

const BGC_SUPABASE_URL = process.env.BGC_SUPABASE_URL ?? 'https://yhgtwqdsnrslcgdvmunz.supabase.co';
const BGC_SUPABASE_ANON_KEY = process.env.BGC_SUPABASE_ANON_KEY;

/** Be a good citizen: geekdo is doing us a favour by still answering. */
const REQUEST_GAP_MS = 350;

interface CollectionEntry {
  bggId: number;
  title: string;
  year: number | null;
}

interface BggDetail {
  name: string;
  year: number | null;
  thumb: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minTime: number | null;
  maxTime: number | null;
  rating: number | null;
  weight: number | null;
  bestWith: number[];
}

/**
 * A game mid-merge. Identical to the published `LibraryGame` except that it
 * still knows who lends each copy — needed to count duplicates correctly, and
 * dropped to a bare number before the game is written. Lender names must not
 * reach `library_titles`, which GET /api/catalogue publishes; they go to
 * `library_title_owners` instead, which only the admin console reads.
 */
type WorkingGame = Omit<LibraryGame, 'copies'> & {
  copies: { lender: string; source: 'bgc' | 'bgg'; count: number }[];
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Round to one decimal so the JSON does not carry six meaningless digits. */
function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/** Round to two — weights sit in a 1–5 range where the second digit reads. */
function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function readCollections(): { username: string; entries: CollectionEntry[] }[] {
  const files = readdirSync(collectionsDir)
    .filter((name) => name.endsWith('.tsv'))
    .sort();
  if (!files.length) throw new Error(`no collection harvests found in ${collectionsDir}`);

  return files.map((file) => {
    const username = file.replace(/\.tsv$/, '');
    const entries: CollectionEntry[] = [];
    const lines = readFileSync(join(collectionsDir, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const [rawId, title, rawYear] = line.split('\t');
      const bggId = Number(rawId);
      if (!Number.isInteger(bggId) || bggId <= 0 || !title?.trim()) {
        throw new Error(`${file}:${index + 1} is not "<bggId>\\t<title>\\t<year>": ${line}`);
      }
      entries.push({ bggId, title: title.trim(), year: num(rawYear) });
    });
    return { username, entries };
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'replaycon.in library sync (hello@replaycon.in)' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

/**
 * Pull one game's detail from the two geekdo endpoints that still answer:
 * `geekitems` for the box (names, seats, minutes, art) and `dynamicinfo` for
 * the community numbers (rating, weight, the best-player-count poll).
 */
async function fetchDetail(bggId: number): Promise<BggDetail> {
  const cachePath = join(cacheDir, `${bggId}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8')) as BggDetail;

  const item = (await fetchJson(
    `https://api.geekdo.com/api/geekitems?objectid=${bggId}&objecttype=thing&subtype=boardgame`,
  )) as { item?: Record<string, any> };
  await sleep(REQUEST_GAP_MS);
  const dynamic = (await fetchJson(
    `https://api.geekdo.com/api/dynamicinfo?objectid=${bggId}&objecttype=thing`,
  )) as { item?: Record<string, any> };
  await sleep(REQUEST_GAP_MS);

  const box = item.item ?? {};
  const stats = dynamic.item?.stats ?? {};
  const players = dynamic.item?.polls?.userplayers?.best ?? [];

  // The poll reports ranges ("best at 3–4"); flatten them into the discrete
  // counts the filter chips work in.
  const bestWith: number[] = [];
  for (const range of players as { min?: number; max?: number }[]) {
    const min = Number(range.min);
    const max = Number(range.max ?? range.min);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    for (let count = min; count <= max && count <= 20; count += 1) bestWith.push(count);
  }

  const detail: BggDetail = {
    name: typeof box.name === 'string' ? box.name : '',
    year: num(box.yearpublished),
    thumb: typeof box.images?.thumb === 'string' ? box.images.thumb : null,
    minPlayers: num(box.minplayers),
    maxPlayers: num(box.maxplayers),
    minTime: num(box.minplaytime),
    maxTime: num(box.maxplaytime),
    rating: round1(num(stats.average)),
    weight: round2(num(stats.avgweight)),
    bestWith: [...new Set(bestWith)].sort((a, b) => a - b),
  };

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(detail));
  return detail;
}

interface BgcRow {
  title: string;
  player_count: string | null;
  max_players: number | null;
  avg_rating: string | number | null;
  weight: string | number | null;
  play_time: string | null;
  max_play_time: number | null;
  owned_by: string | null;
}

async function fetchBgcRows(): Promise<BgcRow[]> {
  if (!BGC_SUPABASE_ANON_KEY) {
    throw new Error(
      'BGC_SUPABASE_ANON_KEY is not set. Export the bgc-website project\'s publishable/anon key before running the sync.',
    );
  }
  const client = createClient(BGC_SUPABASE_URL, BGC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from('games')
    .select('title, player_count, max_players, avg_rating, weight, play_time, max_play_time, owned_by')
    .order('title');
  if (error) throw new Error(`bgc-website games read failed: ${error.message}`);
  return (data ?? []) as BgcRow[];
}

/** "2-7" → 2, "6-21" → 6, "2" → 2. */
function minFromRange(range: string | null): number | null {
  if (!range) return null;
  return num(range.split(/[-–]/)[0]);
}

/**
 * The BGC sheet's own rating/weight columns are hand-entered and have known
 * transpositions in them (one row records a 3.41 rating and a 7.80 weight).
 * Only trust a value that lands in its column's real range; anything else is
 * treated as absent, and a BGG match will fill it in.
 */
function plausibleRating(value: string | number | null): number | null {
  const parsed = num(value);
  return parsed !== null && parsed <= 10 ? round1(parsed) : null;
}

function plausibleWeight(value: string | number | null): number | null {
  const parsed = num(value);
  return parsed !== null && parsed <= 5 ? round2(parsed) : null;
}

/**
 * Title aliases, keyed by folded title.
 *
 * Was `src/data/bgc-bgg-ids.tsv`; now a table the admin console writes to, so
 * fixing "the club sheet spells this differently" no longer needs a commit.
 * The fold has to match `foldTitle` in worker/src/admin/catalogue.ts, which is
 * why both are `titleKey` from src/lib/game-library.ts.
 */
async function loadAliases(sb: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await sb.from('library_title_aliases').select('folded_title, bgg_id').limit(5000);
  if (error) throw new Error(`could not read library_title_aliases: ${error.message}`);
  return new Map((data ?? []).map((row: { folded_title: string; bgg_id: number }) => [row.folded_title, row.bgg_id]));
}

interface Curation {
  /** BGG ids an admin has taken off the shelf. Not enriched, not published. */
  offShelfIds: Set<number>;
  /** Folded titles of off-shelf games that have no BGG id. */
  offShelfTitles: Set<string>;
  /** Title key → the copy count an admin pinned by hand. */
  overrides: Map<string, number>;
  /** Title key → what the row already says, so a sync can leave it alone. */
  existing: Map<string, CatalogueRow>;
  byBggId: Map<number, CatalogueRow>;
}

interface CatalogueRow {
  id: string;
  key: string;
  bgg_id: number | null;
  title: string;
  source: string;
  shelf_status: string;
  copies_override: number | null;
}

/**
 * What the admin console has decided, which this run must not undo.
 *
 * Replaces `src/data/excluded-games.tsv` entirely. A game taken off the shelf
 * keeps its row — that is what lets somebody put it back — so unlike the old
 * file, nothing here removes anything. It only says what not to touch.
 */
async function loadCuration(sb: SupabaseClient): Promise<Curation> {
  const { data, error } = await sb
    .from('library_titles')
    .select('id, key, bgg_id, title, source, shelf_status, copies_override')
    .limit(5000);
  if (error) throw new Error(`could not read library_titles: ${error.message}`);
  const rows = (data ?? []) as CatalogueRow[];

  const curation: Curation = {
    offShelfIds: new Set(),
    offShelfTitles: new Set(),
    overrides: new Map(),
    existing: new Map(),
    byBggId: new Map(),
  };
  for (const row of rows) {
    curation.existing.set(row.key, row);
    if (row.bgg_id) curation.byBggId.set(row.bgg_id, row);
    if (row.copies_override !== null) curation.overrides.set(row.key, row.copies_override);
    if (row.shelf_status === 'off_shelf') {
      if (row.bgg_id) curation.offShelfIds.add(row.bgg_id);
      else curation.offShelfTitles.add(titleKey(row.title));
    }
  }
  return curation;
}

/**
 * Source name → what people call them, from `library_owner_names`. Lives only
 * in the database: the repo is public, and a committed handle-to-name map would
 * publish the link the library page is built never to make.
 */
async function loadOwnerNames(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb.from('library_owner_names').select('source_name, display_name').limit(1000);
  if (error) throw new Error(`could not read library_owner_names: ${error.message}`);
  return new Map(
    (data ?? []).map((row: { source_name: string; display_name: string }) => [row.source_name, row.display_name]),
  );
}

function addCopy(game: WorkingGame, lender: string, source: 'bgc' | 'bgg'): void {
  const existing = game.copies.find((copy) => copy.lender === lender && copy.source === source);
  if (existing) existing.count += 1;
  else game.copies.push({ lender, source, count: 1 });
}

async function main(): Promise<void> {
  if (!REPLAY_URL || !REPLAY_SERVICE_KEY) {
    console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set — the catalogue lives in the database now.');
    console.error('  SUPABASE_SERVICE_KEY=... BGC_SUPABASE_ANON_KEY=... npm run sync:library');
    process.exit(1);
  }
  const replay = createClient(REPLAY_URL, REPLAY_SERVICE_KEY, { auth: { persistSession: false } });

  const collections = readCollections();
  const idOverrides = await loadAliases(replay);
  const curation = await loadCuration(replay);
  const ownerNames = await loadOwnerNames(replay);
  const bgcRows = await fetchBgcRows();

  const byKey = new Map<string, WorkingGame>();
  const sources: LibrarySourceSummary[] = [];

  // --- BGG collections first, because they carry the BGG ids that let the
  // --- BGC rows inherit real box data instead of hand-typed approximations.
  // A game somebody took off the shelf is skipped here, so it costs no
  // requests on a cold run — the same saving the exclusion file used to make.
  const uniqueIds = new Set<number>();
  for (const { entries } of collections) {
    for (const entry of entries) {
      if (curation.offShelfIds.has(entry.bggId)) continue;
      uniqueIds.add(entry.bggId);
    }
  }
  // Aliased BGC titles need the same box data, so enrich their ids too.
  for (const row of bgcRows) {
    const bggId = idOverrides.get(titleKey(row.title ?? ''));
    if (bggId && !curation.offShelfIds.has(bggId)) uniqueIds.add(bggId);
  }
  console.log(`Enriching ${uniqueIds.size} unique BGG ids (cached: ${existsSync(cacheDir) ? readdirSync(cacheDir).length : 0})…`);

  const details = new Map<number, BggDetail>();
  let done = 0;
  for (const bggId of uniqueIds) {
    try {
      details.set(bggId, await fetchDetail(bggId));
    } catch (error) {
      console.warn(`  ! ${bggId}: ${(error as Error).message}`);
    }
    done += 1;
    if (done % 50 === 0) console.log(`  …${done}/${uniqueIds.size}`);
  }

  for (const { username, entries } of collections) {
    for (const entry of entries) {
      const detail = details.get(entry.bggId);
      const key = `bgg-${entry.bggId}`;
      let game = byKey.get(key);
      if (!game) {
        const title = detail?.name || entry.title;
        game = {
          key,
          bggId: entry.bggId,
          title,
          year: detail?.year ?? entry.year,
          thumb: detail?.thumb ?? null,
          minPlayers: detail?.minPlayers ?? null,
          maxPlayers: detail?.maxPlayers ?? null,
          minTime: detail?.minTime ?? null,
          maxTime: detail?.maxTime ?? null,
          rating: detail?.rating ?? null,
          weight: detail?.weight ?? null,
          bestWith: detail?.bestWith ?? [],
          copies: [],
        };
        byKey.set(key, game);
      }
      addCopy(game, username, 'bgg');
    }
  }
  sources.push({
    // Deliberately unnamed. These are four people's personal collections, and
    // the published page does not carry their names or handles.
    label: 'Personal collections',
    detail: `${collections.length} collectors pooling their shelves for the weekend`,
    count: collections.reduce((total, { entries }) => total + entries.length, 0),
  });

  // Index by folded title so a BGC row can join a card a BGG collection made.
  const byTitle = new Map<string, WorkingGame>();
  for (const game of byKey.values()) byTitle.set(titleKey(game.title), game);

  // --- BGC club library. Rows repeat per owner, and occasionally per copy.
  for (const row of bgcRows) {
    const title = row.title.trim();
    if (!title) continue;
    const folded = titleKey(title);

    // An override resolves the row straight onto its BGG card, which is both
    // where the box art lives and where any duplicate copy already sits.
    const overrideId = idOverrides.get(folded);
    let game = overrideId ? byKey.get(`bgg-${overrideId}`) : byTitle.get(folded);

    if (!game && overrideId) {
      const detail = details.get(overrideId);
      game = {
        key: `bgg-${overrideId}`,
        bggId: overrideId,
        title: detail?.name || title,
        year: detail?.year ?? null,
        thumb: detail?.thumb ?? null,
        minPlayers: detail?.minPlayers ?? null,
        maxPlayers: detail?.maxPlayers ?? null,
        minTime: detail?.minTime ?? null,
        maxTime: detail?.maxTime ?? null,
        rating: detail?.rating ?? null,
        weight: detail?.weight ?? null,
        bestWith: detail?.bestWith ?? [],
        copies: [],
      };
      byKey.set(game.key, game);
      byTitle.set(titleKey(game.title), game);
    }

    if (!game) {
      const key = `title-${titleSlug(title)}`;
      game = byKey.get(key);
      if (!game) {
        game = {
          key,
          bggId: null,
          title,
          year: null,
          thumb: null,
          minPlayers: minFromRange(row.player_count),
          maxPlayers: row.max_players ?? null,
          minTime: minFromRange(row.play_time),
          maxTime: row.max_play_time ?? null,
          rating: plausibleRating(row.avg_rating),
          weight: plausibleWeight(row.weight),
          bestWith: [],
          copies: [],
        };
        byKey.set(key, game);
        byTitle.set(folded, game);
      }
    } else {
      // Matched a BGG card. BGG's numbers win — they are the community's, not
      // one volunteer's — but fill any gap the BGG record left open.
      game.minPlayers ??= minFromRange(row.player_count);
      game.maxPlayers ??= row.max_players ?? null;
      game.minTime ??= minFromRange(row.play_time);
      game.maxTime ??= row.max_play_time ?? null;
      game.rating ??= plausibleRating(row.avg_rating);
      game.weight ??= plausibleWeight(row.weight);
    }

    addCopy(game, row.owned_by?.trim() || 'BGC', 'bgc');
  }

  sources.unshift({
    label: 'Bangalore Games Club library',
    detail: 'The club collection, including members who lend their own copies',
    count: bgcRows.length,
  });

  // A guard, not a formality: this file is served to the public verbatim, and
  // a future edit that forgets to strip `lender` would ship real names.
  const leaked = JSON.stringify([...byKey.values()].map(({ copies, ...rest }) => rest));
  if (/lender/i.test(leaked)) throw new Error('lender data reached the published game shape');

  // Who lends what, kept apart from the game shape so it can only ever be
  // written to the private owners table.
  const owners = new Map<string, OwnerRow[]>();
  for (const game of byKey.values()) owners.set(game.key, ownerRows(game.copies, ownerNames));

  // Collapse each game's per-lender copies to a bare count. This is the step
  // that keeps names out of `library_titles` — nothing downstream of here
  // has them to leak.
  // Drop excluded games. Collection-scoped exclusions have already been
  // applied above, where the copy would have been added.
  const games: LibraryGame[] = [...byKey.values()]
    .sort((a, b) => a.title.localeCompare(b.title, 'en'))
    .map(({ copies, ...game }) => ({
      ...game,
      copies: copies.reduce((total, copy) => total + copy.count, 0),
    }));

  const report = await writeCatalogue(replay, games, sources, curation, owners);

  const withArt = games.filter((game) => game.thumb).length;
  const withPlayers = games.filter((game) => game.minPlayers !== null).length;
  console.log(`\nWrote ${games.length} games to library_titles`);
  console.log(`  ${report.inserted} new, ${report.updated} refreshed, ${report.skipped} left alone`);
  console.log(`  ${report.copiesAdded} copies added, ${report.copiesWithdrawn} withdrawn, ${report.copiesRestored} restored`);
  console.log(`  ${report.ownerRows} owner attributions across ${report.owners} owners`);
  console.log(`  ${withArt} with box art, ${withPlayers} with a player count`);
  console.log(`  ${curation.offShelfIds.size + curation.offShelfTitles.size} off the shelf (unchanged by this run)`);

  // An alias that matches nothing is almost always a typo or a club title that
  // has since been renamed — either way the row is now lying.
  const foldedTitles = new Set(bgcRows.map((row) => titleKey(row.title ?? '')));
  const unusedAliases = [...idOverrides.keys()].filter((folded) => !foldedTitles.has(folded));
  if (unusedAliases.length) {
    console.log(`  ! ${unusedAliases.length} alias(es) matched no club title — stale or mistyped:`);
    for (const folded of unusedAliases) console.log(`      ${folded}`);
  }

  // An override that equals what the collections actually lend is doing
  // nothing, and will keep doing nothing silently until somebody checks.
  const redundant = games.filter((game) => curation.overrides.get(game.key) === game.copies);
  if (redundant.length) {
    console.log(`  ! ${redundant.length} pinned copy count(s) now match the shelf and could be cleared:`);
    for (const game of redundant) console.log(`      ${game.title} (${game.copies})`);
  }

  const orphans = games.filter((game) => !game.bggId);
  if (orphans.length) {
    console.log(`  ${orphans.length} BGC titles with no BGG match (no art, sheet data only):`);
    for (const game of orphans) console.log(`    - ${game.title}`);
  }
}

interface WriteReport {
  inserted: number;
  updated: number;
  skipped: number;
  copiesAdded: number;
  copiesWithdrawn: number;
  copiesRestored: number;
  ownerRows: number;
  owners: number;
}

/** Marks a copy that left the pooled collections rather than one the desk pulled. */
const SYNC_ACTOR = 'sync:library';

/**
 * Push the merge into `library_titles`, without treading on the admin.
 *
 * One owner per column is the whole contract. This writes BoardGameGeek
 * metadata and reconciles physical copies; it never writes `shelf_status`,
 * `off_shelf_*` or `copies_override`, and it skips rows whose `source` is
 * 'manual' outright — those were typed in by a person for a game no harvest
 * knows about, and a sync that "tidied" them would delete somebody's work.
 *
 * Games are identified by `bgg_id` where there is one, falling back to `key`.
 * That is what lets an admin link a differently-spelled club title to its BGG
 * entry and have this run agree with them instead of making a second card.
 */
async function writeCatalogue(
  sb: SupabaseClient,
  games: LibraryGame[],
  sources: LibrarySourceSummary[],
  curation: Curation,
  owners: Map<string, OwnerRow[]>,
): Promise<WriteReport> {
  const report: WriteReport = {
    inserted: 0, updated: 0, skipped: 0, copiesAdded: 0, copiesWithdrawn: 0, copiesRestored: 0, ownerRows: 0, owners: 0,
  };
  // title id → owner → copies. Keyed by the row, not the merge key, because a
  // linked club title is found by BGG id under a key of its own.
  const attributions = new Map<string, Map<string, number>>();

  for (const game of games) {
    const row = (game.bggId ? curation.byBggId.get(game.bggId) : undefined) ?? curation.existing.get(game.key);

    if (row?.source === 'manual') { report.skipped += 1; continue; }

    const metadata = {
      bgg_id: game.bggId,
      title: game.title,
      year: game.year,
      thumb: game.thumb,
      min_players: game.minPlayers,
      max_players: game.maxPlayers,
      min_time: game.minTime,
      max_time: game.maxTime,
      rating: game.rating,
      weight: game.weight,
      best_with: game.bestWith ?? [],
      source: game.bggId ? 'bgg' : 'bgc',
      updated_at: new Date().toISOString(),
    };

    let titleId = row?.id;
    if (row) {
      const { error } = await sb.from('library_titles').update(metadata).eq('id', row.id);
      if (error) throw new Error(`${game.key}: ${error.message}`);
      report.updated += 1;
    } else {
      const inserted = await sb.from('library_titles').insert({ key: game.key, ...metadata }).select('id').single();
      if (inserted.error || !inserted.data) throw new Error(`${game.key}: ${inserted.error?.message}`);
      titleId = (inserted.data as { id: string }).id;
      report.inserted += 1;
    }

    // Recorded even where an admin pinned the count: who lends a game is a
    // fact about the sources, not about how many boxes the page advertises.
    if (titleId) {
      const byOwner = attributions.get(titleId) ?? new Map<string, number>();
      for (const { owner, copies } of owners.get(game.key) ?? []) {
        byOwner.set(owner, (byOwner.get(owner) ?? 0) + copies);
      }
      attributions.set(titleId, byOwner);
    }

    // A copy an admin pinned by hand is theirs, not this run's, so the shelf is
    // only reconciled where they have not said otherwise.
    if (row && curation.overrides.has(row.key)) continue;
    if (!titleId) continue;
    const moved = await reconcileCopies(sb, titleId, game.copies);
    report.copiesAdded += moved.added;
    report.copiesWithdrawn += moved.withdrawn;
    report.copiesRestored += moved.restored;
  }

  const { error } = await sb
    .from('library_catalogue_meta')
    .upsert({ id: true, sources, synced_at: new Date().toISOString() });
  if (error) throw new Error(`library_catalogue_meta: ${error.message}`);

  const moved = await replaceOwners(sb, attributions);
  report.ownerRows = moved.rows;
  report.owners = moved.owners;

  return report;
}

/**
 * Rewrite `library_title_owners` from this run's merge.
 *
 * Wholesale rather than per title, so a game that has left every source loses
 * its attribution too, and so the whole thing is two statements instead of
 * ~600 round trips. Manual rows never had any, so there is nothing of an
 * admin's here to preserve.
 */
async function replaceOwners(
  sb: SupabaseClient,
  attributions: Map<string, Map<string, number>>,
): Promise<{ rows: number; owners: number }> {
  const rows = [...attributions].flatMap(([titleId, byOwner]) =>
    [...byOwner].map(([owner, copies]) => ({ title_id: titleId, owner, copies })),
  );

  const cleared = await sb.from('library_title_owners').delete().not('title_id', 'is', null);
  if (cleared.error) throw new Error(`library_title_owners: ${cleared.error.message}`);
  for (let start = 0; start < rows.length; start += 500) {
    const { error } = await sb.from('library_title_owners').insert(rows.slice(start, start + 500));
    if (error) throw new Error(`library_title_owners: ${error.message}`);
  }

  return { rows: rows.length, owners: new Set(rows.map((row) => row.owner)).size };
}

/**
 * Make the number of lendable boxes match what the collections lend.
 *
 * Nothing is ever deleted — `service_role` has no `delete` on `library_copies`,
 * and a loan pointing at a vanished copy would destroy the only record of who
 * had it. A copy that has left the pool is *withdrawn*, attributed to the sync
 * so the desk can tell it apart from a box somebody pulled for a missing piece,
 * and a copy that comes back is restored before any new row is made.
 *
 * A copy currently out on loan is never withdrawn: somebody is holding it, and
 * the shelf can be corrected when it comes back.
 */
async function reconcileCopies(
  sb: SupabaseClient,
  titleId: string,
  wanted: number,
): Promise<{ added: number; withdrawn: number; restored: number }> {
  const { data, error } = await sb
    .from('library_copies')
    .select('id, copy_number, status, withdrawn_by')
    .eq('title_id', titleId)
    .order('copy_number');
  if (error) throw new Error(`copies for ${titleId}: ${error.message}`);
  const copies = (data ?? []) as Array<{ id: string; copy_number: number; status: string; withdrawn_by: string | null }>;

  const live = copies.filter((copy) => copy.status === 'available');
  const mine = copies.filter((copy) => copy.status === 'withdrawn' && copy.withdrawn_by === SYNC_ACTOR);
  let added = 0;
  let withdrawn = 0;
  let restored = 0;

  if (live.length > wanted) {
    const open = await sb
      .from('library_loans')
      .select('copy_id')
      .in('status', ['requested', 'checked_out'])
      .in('copy_id', live.map((copy) => copy.id));
    const busy = new Set(((open.data ?? []) as Array<{ copy_id: string }>).map((row) => row.copy_id));
    const spare = live.filter((copy) => !busy.has(copy.id)).reverse();
    for (const copy of spare.slice(0, live.length - wanted)) {
      const { error: failed } = await sb
        .from('library_copies')
        .update({
          status: 'withdrawn',
          withdrawn_at: new Date().toISOString(),
          withdrawn_by: SYNC_ACTOR,
          withdrawn_note: 'No longer lent by any of the pooled collections',
        })
        .eq('id', copy.id);
      if (failed) throw new Error(`withdraw ${copy.id}: ${failed.message}`);
      withdrawn += 1;
    }
    return { added, withdrawn, restored };
  }

  let short = wanted - live.length;
  for (const copy of mine.slice(0, short)) {
    const { error: failed } = await sb
      .from('library_copies')
      .update({ status: 'available', withdrawn_at: null, withdrawn_by: null, withdrawn_note: null })
      .eq('id', copy.id);
    if (failed) throw new Error(`restore ${copy.id}: ${failed.message}`);
    restored += 1;
    short -= 1;
  }

  if (short > 0) {
    const highest = copies.reduce((top, copy) => Math.max(top, copy.copy_number), 0);
    const rows = Array.from({ length: short }, (_, index) => ({
      title_id: titleId,
      copy_number: highest + index + 1,
    }));
    const { error: failed } = await sb.from('library_copies').insert(rows);
    if (failed) throw new Error(`add copies to ${titleId}: ${failed.message}`);
    added += short;
  }

  return { added, withdrawn, restored };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
