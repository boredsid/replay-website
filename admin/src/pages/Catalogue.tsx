import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import RebuildSiteButton from '@/components/RebuildSiteButton';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { CatalogueGameRow } from '@/lib/types';

/**
 * The shelf itself, as opposed to /library, which is the desk that lends from
 * it. Same table underneath; different question. This one answers "is this game
 * coming at all", and until it existed the answer was changed by opening a pull
 * request against a committed JSON file.
 */

type Filter = 'all' | 'on_shelf' | 'off_shelf' | 'no_art' | 'manual';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'on_shelf', label: 'On the shelf' },
  { key: 'off_shelf', label: 'Off the shelf' },
  { key: 'no_art', label: 'No box art' },
  { key: 'manual', label: 'Added by hand' },
];

/** Matches the public page's fold, so searching here finds what a visitor finds. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function players(game: CatalogueGameRow): string {
  if (!game.min_players && !game.max_players) return '—';
  if (game.min_players && game.max_players && game.min_players !== game.max_players) {
    return `${game.min_players}–${game.max_players}`;
  }
  return String(game.max_players ?? game.min_players);
}

export default function Catalogue() {
  const [games, setGames] = useState<CatalogueGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  async function load() {
    try {
      const response = await fetchAdmin<{ games: CatalogueGameRow[] }>('/api/admin/catalogue');
      setGames(response.games);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const off = onRevalidate(() => { void load(); });
    return () => { off(); };
  }, []);

  const counts = useMemo(() => ({
    on: games.filter((game) => game.shelf_status === 'on_shelf' && game.copies > 0).length,
    off: games.filter((game) => game.shelf_status === 'off_shelf').length,
    noArt: games.filter((game) => game.shelf_status === 'on_shelf' && !game.thumb).length,
  }), [games]);

  const shown = useMemo(() => {
    const needle = fold(query.trim());
    return games.filter((game) => {
      if (needle && !fold(game.title).includes(needle)) return false;
      switch (filter) {
        case 'on_shelf': return game.shelf_status === 'on_shelf';
        case 'off_shelf': return game.shelf_status === 'off_shelf';
        // Only on-shelf games: a removed game having no picture is not a
        // problem anybody needs to fix.
        case 'no_art': return game.shelf_status === 'on_shelf' && !game.thumb;
        case 'manual': return game.source === 'manual';
        default: return true;
      }
    });
  }, [games, query, filter]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Game catalogue</h1>
          <p className="text-sm text-muted-foreground">
            Every game on the shelf, and the ones taken off it. This is what the library page lists and what the desk
            can lend.
          </p>
        </div>
        <Link
          to="/catalogue/new"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Add a game
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
        <p className="text-sm text-muted-foreground">
          The library page is built ahead of time, so changes here reach replaycon.in on the next rebuild. The desk
          stops lending a removed game straight away.
        </p>
        <RebuildSiteButton className="bg-background" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title"
            aria-label="Search the catalogue"
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              aria-pressed={filter === option.key}
              className={`rounded-full border px-3 py-1 text-sm ${
                filter === option.key ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {counts.on} on the shelf · {counts.off} taken off
        {counts.noArt > 0 && <> · {counts.noArt} with no box art</>}
      </p>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-md border bg-background p-6">
          <h2 className="font-semibold">Nothing matches</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {query ? 'No game with that in its title.' : 'No game in this group.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {shown.map((game) => (
            <li key={game.id}>
              <Link
                to={`/catalogue/${game.id}`}
                className={`flex items-center gap-3 rounded-md border bg-background p-3 hover:bg-muted ${
                  game.shelf_status === 'off_shelf' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                  {game.thumb ? (
                    <img src={game.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    // The same monogram the public page falls back to.
                    <span className="text-lg font-semibold text-muted-foreground">
                      {game.title.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {game.title}
                    {game.year && <span className="ml-1.5 font-normal text-muted-foreground">{game.year}</span>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {players(game)} players · {game.copies} {game.copies === 1 ? 'copy' : 'copies'}
                    {game.copies_override !== null && <> (set by hand)</>}
                    {game.shelf_status === 'off_shelf' && game.off_shelf_note && <> · {game.off_shelf_note}</>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5 text-xs">
                  {game.shelf_status === 'off_shelf' && (
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-zinc-800">Off the shelf</span>
                  )}
                  {game.source === 'manual' && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-900">Added by hand</span>
                  )}
                  {!game.bgg_id && game.shelf_status === 'on_shelf' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-950">No BGG entry</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
