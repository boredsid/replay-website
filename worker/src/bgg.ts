// The one BoardGameGeek client.
//
// Authoritative for both callers: the Worker uses it to fetch a box when an
// admin adds a game by id, and `scripts/sync-game-library.ts` imports it for
// the harvest merge. It is deliberately free of Worker and Node APIs — plain
// `fetch` and nothing else — so the two cannot drift the way a ported copy
// would.
//
// What BGG still answers, verified again 2026-09-09:
//
//   api.geekdo.com/api/geekitems?objectid=&objecttype=thing&subtype=boardgame
//     200 — name, year, player counts, play times, box art
//   api.geekdo.com/api/dynamicinfo?objectid=&objecttype=thing
//     200 — community rating, weight, best-player-count poll
//
// Everything else is shut: both XML APIs answer 401 `Bearer realm="xml api"`,
// the HTML collection pages answer 403 `cf-mitigated: challenge`, and
// `geeksearch.php` answers 403 to anything that is not a browser. **There is no
// search by name from a server**, which is why adding a game takes an id or a
// pasted BGG URL rather than a search box. See docs/reference/GAME_LIBRARY.md.

export interface BggDetail {
  name: string;
  year: number | null;
  thumb: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Minutes. */
  minTime: number | null;
  maxTime: number | null;
  /** Community average, 0–10. */
  rating: number | null;
  /** Community weight, 1–5. */
  weight: number | null;
  /** Player counts the poll calls "best". Empty when unpolled. */
  bestWith: number[];
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** One decimal, so a rating does not carry six meaningless digits. */
function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/** Two — weights sit in a 1–5 range where the second digit reads. */
function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

/**
 * A BGG id out of whatever somebody pasted.
 *
 * Accepts a bare id or any BGG URL, including the `boardgameexpansion` and
 * `rpgitem` forms — the lookup endpoint ignores `subtype` and returns full data
 * for all of them, so an expansion needs no special handling here. Taking the
 * id straight out of the URL is also the documented way to find one, since the
 * search page cannot be reached from a script.
 */
export function parseBggRef(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  // .../boardgame/194655/santorini, .../boardgameexpansion/240909/...
  const fromPath = trimmed.match(/boardgamegeek\.com\/[a-z]+\/(\d+)/i);
  if (fromPath) return Number(fromPath[1]);
  // .../geekitems?objectid=194655&...
  const fromQuery = trimmed.match(/[?&]objectid=(\d+)/i);
  if (fromQuery) return Number(fromQuery[1]);
  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'replaycon.in library sync (hello@replaycon.in)' },
  });
  if (!response.ok) throw new Error(`bgg_http_${response.status}`);
  return response.json();
}

/**
 * Flattens the best-player-count poll.
 *
 * BGG reports ranges ("best at 3–4"); the filter chips on both the site and the
 * app work in discrete counts, so a range becomes each count inside it. Capped
 * at 20 because a party game claiming "best at 99" is noise in a filter.
 */
export function flattenBestWith(ranges: unknown): number[] {
  if (!Array.isArray(ranges)) return [];
  const counts: number[] = [];
  for (const range of ranges as { min?: number; max?: number }[]) {
    const min = Number(range?.min);
    const max = Number(range?.max ?? range?.min);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    for (let count = min; count <= max && count <= 20; count += 1) counts.push(count);
  }
  return [...new Set(counts)].sort((a, b) => a - b);
}

/** Shapes the two responses into a box. Pure, so it can be tested without BGG. */
export function toDetail(item: unknown, dynamic: unknown): BggDetail {
  const box = ((item as { item?: Record<string, any> })?.item ?? {}) as Record<string, any>;
  const dyn = (dynamic as { item?: Record<string, any> })?.item ?? {};
  const stats = dyn.stats ?? {};
  return {
    name: typeof box.name === 'string' ? box.name : '',
    year: num(box.yearpublished),
    thumb: typeof box.images?.thumb === 'string' ? box.images.thumb : null,
    minPlayers: num(box.minplayers),
    maxPlayers: num(box.maxplayers),
    minTime: num(box.minplaytime),
    maxTime: num(box.maxplaytime),
    rating: round1(num(stats.average)),
    weight: round2(num(stats.avgweight)),
    bestWith: flattenBestWith(dyn.polls?.userplayers?.best),
  };
}

/**
 * One game's box.
 *
 * Throws `bgg_not_found` for an id BGG does not know, rather than returning a
 * nameless husk — a game with no name would be saved as a blank row and be
 * impossible to find again in the admin list.
 */
export async function fetchBggDetail(bggId: number): Promise<BggDetail> {
  const [item, dynamic] = await Promise.all([
    fetchJson(`https://api.geekdo.com/api/geekitems?objectid=${bggId}&objecttype=thing&subtype=boardgame`),
    fetchJson(`https://api.geekdo.com/api/dynamicinfo?objectid=${bggId}&objecttype=thing`),
  ]);
  const detail = toDetail(item, dynamic);
  if (!detail.name) throw new Error('bgg_not_found');
  return detail;
}
