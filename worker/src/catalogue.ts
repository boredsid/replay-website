// The published game catalogue.
//
// `library_titles` is the source of truth, and this is the one place that turns
// its rows into the shape the outside world sees. Both readers go through it:
//
//   the public site   astro build fetches GET /api/catalogue
//   the attendee app  its Vite build fetches the same, and bundles the result
//
// Reading through the Worker rather than opening the table to `anon` is
// deliberate. `library_titles` sits beside `library_copies` and `library_loans`
// behind "nothing reaches these except the Worker", and the catalogue is the
// only part of that group anyone outside is allowed to see. One projection here
// is easier to keep honest than a grant that has to be re-argued every time a
// column is added.
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonResponse, CORS_HEADERS } from './validation';
import { serviceClient } from './supabase';
import type { Env } from './index';

/** Mirrors `LibraryGame` in src/lib/game-library.ts, which both readers parse into. */
export interface CatalogueGame {
  key: string;
  bggId: number | null;
  title: string;
  year: number | null;
  thumb: string | null;
  description?: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minTime: number | null;
  maxTime: number | null;
  rating: number | null;
  weight: number | null;
  bestWith: number[];
  copies: number;
}

export interface CatalogueSource {
  label: string;
  detail: string;
  count: number;
}

export interface CatalogueSnapshot {
  /** ISO date, so the page can say "snapshot taken ...". */
  generatedAt: string;
  sources: CatalogueSource[];
  games: CatalogueGame[];
}

interface TitleRow {
  id: string;
  key: string;
  bgg_id: number | null;
  title: string;
  year: number | null;
  thumb: string | null;
  description: string | null;
  min_players: number | null;
  max_players: number | null;
  min_time: number | null;
  max_time: number | null;
  rating: number | string | null;
  weight: number | string | null;
  best_with: number[] | null;
  source: string;
  copies_override: number | null;
}

/** `numeric` arrives from PostgREST as a string; the page wants a number. */
function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCatalogueGame(row: TitleRow, copyCount: number): CatalogueGame {
  return {
    key: row.key,
    bggId: row.bgg_id,
    title: row.title,
    year: row.year,
    thumb: row.thumb,
    description: row.description,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    minTime: row.min_time,
    maxTime: row.max_time,
    rating: toNumber(row.rating),
    weight: toNumber(row.weight),
    bestWith: row.best_with ?? [],
    // An override is what the admin says is coming; otherwise it is however
    // many boxes exist. Not filtered by `status`: a copy withdrawn at the desk
    // for a missing piece should not silently rewrite a page that is rebuilt
    // once a week, and live availability is answered by /api/app/library.
    copies: row.copies_override ?? copyCount,
  };
}

const PUBLISHED_COLUMNS =
  'id, key, bgg_id, title, year, thumb, description, min_players, max_players, ' +
  'min_time, max_time, rating, weight, best_with, source, copies_override';

/**
 * Every on-shelf game, with its copy count.
 *
 * A title with no copies and no override is left out rather than published with
 * a zero: it means nobody is bringing it, which is a card that would advertise
 * an empty space on the shelf.
 */
export async function loadCatalogue(sb: SupabaseClient): Promise<CatalogueSnapshot> {
  const titles = await sb
    .from('library_titles')
    .select(PUBLISHED_COLUMNS)
    .eq('shelf_status', 'on_shelf')
    .order('title', { ascending: true })
    .limit(5000);
  if (titles.error) throw new Error(`catalogue_query_failed: ${titles.error.message}`);

  const rows = (titles.data ?? []) as unknown as TitleRow[];

  const copies = await sb.from('library_copies').select('title_id').limit(20000);
  if (copies.error) throw new Error(`catalogue_copies_failed: ${copies.error.message}`);
  const counts = new Map<string, number>();
  for (const copy of (copies.data ?? []) as { title_id: string }[]) {
    counts.set(copy.title_id, (counts.get(copy.title_id) ?? 0) + 1);
  }

  const games = rows
    .map((row) => toCatalogueGame(row, counts.get(row.id) ?? 0))
    .filter((game) => game.copies > 0);

  const meta = await sb
    .from('library_catalogue_meta')
    .select('sources, synced_at')
    .eq('id', true)
    .maybeSingle();
  const sources = ((meta.data?.sources ?? []) as CatalogueSource[]).slice();

  // Games the team added by hand are a source the harvest cannot know about,
  // so the card is derived here rather than written by the sync.
  const added = rows.filter((row) => row.source === 'manual').length;
  if (added > 0) {
    sources.push({
      label: 'Added by the REPLAY team',
      detail: 'Games brought to the shelf outside the pooled collections',
      count: added,
    });
  }

  const syncedAt = (meta.data?.synced_at as string | undefined) ?? new Date().toISOString();
  return { generatedAt: syncedAt.slice(0, 10), sources, games };
}

/**
 * GET /api/catalogue — public, and read by two builds rather than by browsers.
 *
 * Cached for five minutes at the edge. The readers are build steps, so a stale
 * minute costs nothing and a burst of parallel builds costs BGG-sized queries
 * against Postgres if it is not there.
 */
export async function handleCatalogue(env: Env): Promise<Response> {
  const sb = serviceClient(env);
  try {
    const snapshot = await loadCatalogue(sb);
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return jsonResponse({ error: 'catalogue_unavailable' }, 503);
  }
}
