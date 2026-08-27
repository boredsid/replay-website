// src/lib/game-library.ts
// Types and pure filtering helpers for the `/library` page.
//
// The data itself is a committed snapshot at `src/data/game-library.json`,
// rebuilt on demand by `npm run sync:library` — see that script's header for
// why the merge does not happen at build time.
//
// Everything here is deliberately pure and framework-free: the Astro page
// imports it for the server-rendered summary, and `GameLibrary.tsx` imports
// the same functions so the client-side filtering cannot drift from what the
// page claims.

export interface LibraryGame {
  /** Stable dedupe key: `bgg-<id>`, or `title-<slug>` when BGG has no match. */
  key: string;
  bggId: number | null;
  title: string;
  year: number | null;
  /** BGG's small box shot. Null for BGC rows with no BGG match. */
  thumb: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Minutes. */
  minTime: number | null;
  maxTime: number | null;
  /** BGG community average, 0–10. */
  rating: number | null;
  /** BGG community weight, 1–5. */
  weight: number | null;
  /** Player counts the BGG poll calls "best". Empty when unpolled. */
  bestWith: number[];
  /**
   * Physical copies on the shelf, across every contributing collection.
   *
   * Deliberately a bare number. Who lends which copy is tracked inside the
   * sync script so duplicates can be counted, but it is dropped before the
   * snapshot is written — the published page must not carry people's names.
   */
  copies: number;
}

export interface LibrarySourceSummary {
  label: string;
  detail: string;
  /** Entries this source contributed, before cross-source dedupe. */
  count: number;
}

export interface LibrarySnapshot {
  /** ISO date the snapshot was built. */
  generatedAt: string;
  sources: LibrarySourceSummary[];
  games: LibraryGame[];
}

/**
 * Fold a title down to a comparison key.
 *
 * This is what lets a BGC row with no BGG id ("Shasn") find its way onto the
 * same card as `SHASN` from a BGG collection. It is deliberately aggressive —
 * case, accents, punctuation and leading articles all go — because the two
 * sources are typed by different people and agree on almost nothing else.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/**
 * The key two sources have to agree on to land on the same card.
 *
 * Tighter than `normalizeTitle` because it also removes the spaces: the BGC
 * sheet writes `Q.E.` where BGG has `QE`, and word boundaries are exactly what
 * the two disagree about. Spaces are kept in `normalizeTitle` because search
 * runs a substring match, where collapsing them would let "artofw" hit.
 */
export function titleKey(title: string): string {
  return normalizeTitle(title).replace(/ /g, '');
}

/** `normalizeTitle` output as a URL-safe slug, for keys on unmatched titles. */
export function titleSlug(title: string): string {
  return normalizeTitle(title).replace(/ /g, '-');
}

export type WeightBand = 'light' | 'medium' | 'heavy';

export const WEIGHT_BANDS: { id: WeightBand; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'heavy', label: 'Heavy' },
];

/**
 * BGG weight (1–5) to the three words people actually use at a table.
 *
 * The cut points match the bands the BGC library sheet already used, so a game
 * does not change category when its row gains a BGG match.
 */
export function weightBand(weight: number | null): WeightBand | null {
  if (weight === null || !Number.isFinite(weight) || weight <= 0) return null;
  if (weight < 2) return 'light';
  if (weight < 3) return 'medium';
  return 'heavy';
}

export type DurationBand = 'quick' | 'short' | 'long' | 'epic';

export const DURATION_BANDS: { id: DurationBand; label: string }[] = [
  { id: 'quick', label: 'Under 30 min' },
  { id: 'short', label: '30–60 min' },
  { id: 'long', label: '1–2 hours' },
  { id: 'epic', label: '2 hours+' },
];

/**
 * Band a game by its *longest* likely play time.
 *
 * Using the max rather than the min is the honest answer to "what can we fit
 * before dinner" — a 30–120 game is not a half-hour game.
 */
export function durationBand(maxTime: number | null): DurationBand | null {
  if (maxTime === null || !Number.isFinite(maxTime) || maxTime <= 0) return null;
  if (maxTime <= 30) return 'quick';
  if (maxTime <= 60) return 'short';
  if (maxTime <= 120) return 'long';
  return 'epic';
}

/** The player-count chips. 8 means "8 or more" so big party games stay findable. */
export const PLAYER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Does `game` play at `count` players? `count` of 8 means 8-or-more. */
export function supportsPlayerCount(game: LibraryGame, count: number): boolean {
  const min = game.minPlayers;
  const max = game.maxPlayers;
  if (min === null && max === null) return false;
  const low = min ?? 1;
  const high = max ?? low;
  // The top chip is open-ended: anything seating 8+ answers it.
  if (count >= 8) return high >= 8;
  return low <= count && count <= high;
}

/** "2–4", "2", "1+" or null when the sources never said. */
export function formatPlayers(game: LibraryGame): string | null {
  const { minPlayers: min, maxPlayers: max } = game;
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return min === max ? `${min}` : `${min}–${max}`;
  return min !== null ? `${min}+` : `up to ${max}`;
}

/** "45 min", "30–60 min", or null. */
export function formatTime(game: LibraryGame): string | null {
  const { minTime: min, maxTime: max } = game;
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}–${max} min`;
  return `${max || min} min`;
}

export interface LibraryFilters {
  /** Free text, matched against the title. */
  query: string;
  /** Empty means "any". */
  players: number[];
  durations: DurationBand[];
  weights: WeightBand[];
}

export const EMPTY_FILTERS: LibraryFilters = {
  query: '',
  players: [],
  durations: [],
  weights: [],
};

/**
 * Apply every active filter. Groups are ANDed, choices within a group are ORed
 * — so "2 players" + "4 players" reads as "plays at 2 or 4", which is what
 * someone standing at the shelf with a fixed group actually means.
 */
export function filterGames(games: LibraryGame[], filters: LibraryFilters): LibraryGame[] {
  const query = normalizeTitle(filters.query);
  return games.filter((game) => {
    if (query && !normalizeTitle(game.title).includes(query)) return false;
    if (filters.players.length && !filters.players.some((count) => supportsPlayerCount(game, count))) {
      return false;
    }
    if (filters.durations.length) {
      const band = durationBand(game.maxTime);
      if (band === null || !filters.durations.includes(band)) return false;
    }
    if (filters.weights.length) {
      const band = weightBand(game.weight);
      if (band === null || !filters.weights.includes(band)) return false;
    }
    return true;
  });
}

export function isFiltered(filters: LibraryFilters): boolean {
  return Boolean(
    filters.query.trim() || filters.players.length || filters.durations.length || filters.weights.length,
  );
}
