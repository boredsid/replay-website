// Rebuilds `src/data/game-library.json` — the committed snapshot behind
// `/library` — from the five sources REPLAY's shelf is drawn from:
//
//   1. `public.games` on the bgc-website Supabase project (the club library)
//   2..5. Four BoardGameGeek collections, harvested into `src/data/bgg/*.tsv`
//
// Run with `npm run sync:library`. Deliberately NOT wired into `astro build`.
//
// Why the snapshot is committed rather than fetched at build time:
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
// So the network work happens here, on demand, and git holds the result.
//
// Refreshing the BGG side: the `.tsv` files are the harvest, one row per game
// as `bggId<TAB>title<TAB>year`. They come from the collection page's table
// and have to be re-harvested through a real browser when a collection
// changes — see docs/GAME_LIBRARY.md. Everything downstream of them, and the
// whole BGC side, is automatic.
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleKey, titleSlug, type LibraryGame, type LibrarySnapshot, type LibrarySourceSummary } from '../src/lib/game-library.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const collectionsDir = join(repoRoot, 'src/data/bgg');
const outputPath = join(repoRoot, 'src/data/game-library.json');
/**
 * Hand-resolved `BGC title <TAB> bggId` pairs.
 *
 * `public.games` has no BGG id column, so a BGC row normally finds its game by
 * folded title. When BGG spells the game differently — the sheet's "Vallamkali"
 * is BGG's "Vallamkali: Boat Races of Alappuzha" — the match fails, and the row
 * becomes a second card for a game already on the shelf, with no box art. This
 * file is the override that repairs those, and it is also what gives BGC-only
 * titles their art. See docs/GAME_LIBRARY.md for how to extend it.
 */
const idOverridesPath = join(repoRoot, 'src/data/bgc-bgg-ids.tsv');
/**
 * Games to keep off the page even though a source still lists them — usually
 * because the owner is no longer bringing them.
 *
 * Kept separate from the harvest because `src/data/bgg/*.tsv` is replaced
 * wholesale whenever a collection is refreshed, so a row deleted there comes
 * straight back. Excluding by BGG id drops the game entirely, including copies
 * contributed by other collections.
 */
const exclusionsPath = join(repoRoot, 'src/data/excluded-games.tsv');
/** Gitignored (all of `scripts/data/` is). Makes a re-run cost no requests. */
const cacheDir = join(repoRoot, 'scripts/data/bgg-cache');

/**
 * The BGC club library lives on its own Supabase project, separate from
 * replay-website's. `public.games` carries a `USING (true)` select policy for
 * `anon`, so the publishable key is all this needs — and the key is only ever
 * read from the environment, never committed.
 */
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
 * dropped to a bare number before anything is written. Lender names must not
 * reach `src/data/game-library.json`; the site serves that file verbatim.
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

/** Read the `title <TAB> bggId` overrides, keyed by folded title. */
function readIdOverrides(): Map<string, number> {
  const overrides = new Map<string, number>();
  if (!existsSync(idOverridesPath)) return overrides;
  readFileSync(idOverridesPath, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (!line.trim() || line.startsWith('#')) return;
      const [title, rawId] = line.split('\t');
      const bggId = Number(rawId);
      if (!title?.trim() || !Number.isInteger(bggId) || bggId <= 0) {
        throw new Error(`bgc-bgg-ids.tsv:${index + 1} is not "<title>\\t<bggId>": ${line}`);
      }
      overrides.set(titleKey(title), bggId);
    });
  return overrides;
}

interface Exclusions {
  ids: Set<number>;
  /** Folded titles, for games with no BGG id. */
  titles: Set<string>;
}

/** Read `excluded-games.tsv`: one BGG id or title per line, `#` for comments. */
function readExclusions(): Exclusions {
  const ids = new Set<number>();
  const titles = new Set<string>();
  if (!existsSync(exclusionsPath)) return { ids, titles };
  readFileSync(exclusionsPath, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const key = line.split('\t')[0]?.trim();
      if (!key) throw new Error(`excluded-games.tsv:${index + 1} has an empty key: ${line}`);
      if (/^\d+$/.test(key)) ids.add(Number(key));
      else titles.add(titleKey(key));
    });
  return { ids, titles };
}

function addCopy(game: WorkingGame, lender: string, source: 'bgc' | 'bgg'): void {
  const existing = game.copies.find((copy) => copy.lender === lender && copy.source === source);
  if (existing) existing.count += 1;
  else game.copies.push({ lender, source, count: 1 });
}

async function main(): Promise<void> {
  const collections = readCollections();
  const idOverrides = readIdOverrides();
  const exclusions = readExclusions();
  const bgcRows = await fetchBgcRows();

  const byKey = new Map<string, WorkingGame>();
  const sources: LibrarySourceSummary[] = [];

  // --- BGG collections first, because they carry the BGG ids that let the
  // --- BGC rows inherit real box data instead of hand-typed approximations.
  // Excluded ids are skipped here as well as filtered at the end, so a removed
  // game costs no requests on a cold run.
  const uniqueIds = new Set<number>();
  for (const { entries } of collections) {
    for (const entry of entries) if (!exclusions.ids.has(entry.bggId)) uniqueIds.add(entry.bggId);
  }
  // Overridden BGC titles need the same box data, so enrich their ids too.
  for (const row of bgcRows) {
    const bggId = idOverrides.get(titleKey(row.title ?? ''));
    if (bggId && !exclusions.ids.has(bggId)) uniqueIds.add(bggId);
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

  // Collapse each game's per-lender copies to a bare count. This is the step
  // that keeps names out of the published file — nothing downstream of here
  // has them to leak.
  // Drop excluded games, and record which exclusion entries actually matched
  // so a typo in the file surfaces instead of silently doing nothing.
  const usedExclusions = new Set<string>();
  const kept = [...byKey.values()].filter((game) => {
    if (game.bggId !== null && exclusions.ids.has(game.bggId)) {
      usedExclusions.add(String(game.bggId));
      return false;
    }
    const folded = titleKey(game.title);
    if (exclusions.titles.has(folded)) {
      usedExclusions.add(folded);
      return false;
    }
    return true;
  });

  const games: LibraryGame[] = kept
    .sort((a, b) => a.title.localeCompare(b.title, 'en'))
    .map(({ copies, ...game }) => ({
      ...game,
      copies: copies.reduce((total, copy) => total + copy.count, 0),
    }));

  const snapshot: LibrarySnapshot = {
    generatedAt: new Date().toISOString().slice(0, 10),
    sources,
    games,
  };

  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const withArt = games.filter((game) => game.thumb).length;
  const withPlayers = games.filter((game) => game.minPlayers !== null).length;
  console.log(`\nWrote ${outputPath}`);
  console.log(`  ${games.length} distinct games from ${sources.length} sources`);
  console.log(`  ${withArt} with box art, ${withPlayers} with a player count`);
  const excludedCount = byKey.size - kept.length;
  console.log(`  ${excludedCount} removed by excluded-games.tsv`);

  // An exclusion that matches nothing is almost always a typo or a game that
  // has already left its source — either way the file is now lying.
  const declared = [...exclusions.ids].map(String).concat([...exclusions.titles]);
  const unused = declared.filter((key) => !usedExclusions.has(key));
  if (unused.length) {
    console.log(`  ! ${unused.length} exclusion(s) matched nothing — stale or mistyped:`);
    for (const key of unused) console.log(`      ${key}`);
  }

  const orphans = games.filter((game) => !game.bggId);
  if (orphans.length) {
    console.log(`  ${orphans.length} BGC titles with no BGG match (no art, sheet data only):`);
    for (const game of orphans) console.log(`    - ${game.title}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
