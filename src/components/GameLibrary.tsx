import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DURATION_BANDS,
  EMPTY_FILTERS,
  filterGames,
  formatPlayers,
  formatTime,
  isFiltered,
  PLAYER_COUNTS,
  weightBand,
  WEIGHT_BANDS,
  type DurationBand,
  type LibraryFilters,
  type LibraryGame,
  type WeightBand,
} from '../lib/game-library';

export interface GameLibraryProps {
  games: LibraryGame[];
}

/**
 * Cards drawn before "Show more" appears.
 *
 * The shelf runs to several hundred games and every card pulls a remote box
 * shot, so rendering the lot on load costs a visible stall on a phone. A page
 * of results is more than anyone scans at once anyway.
 */
const PAGE_SIZE = 72;

const WEIGHT_PILL: Record<WeightBand, string> = {
  light: 'pill-green',
  medium: 'pill-yellow',
  heavy: 'pill-pink',
};

/** Add or remove `value` from a filter array — chips toggle, they don't cycle. */
function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`pill cursor-pointer transition-transform ${active ? 'pill-black' : ''} hover:-translate-y-[1px]`}
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="label-brutal">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function GameCard({ game }: { game: LibraryGame }) {
  const players = formatPlayers(game);
  const time = formatTime(game);
  const band = weightBand(game.weight);

  return (
    <li className="card-flat flex flex-col overflow-hidden">
      <div className="flex items-center justify-center bg-[var(--color-cream)] border-b-3 border-[var(--color-ink)] h-[140px] p-2">
        {game.thumb ? (
          <img
            src={game.thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          // No BGG match, so no box shot. A monogram tile keeps the grid even
          // rather than leaving a hole where the art should be.
          <span
            aria-hidden="true"
            className="font-[family-name:var(--font-heading)] text-4xl font-extrabold text-[#1A1A1A]/25"
          >
            {game.title.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="text-[0.98rem] leading-tight">
          {game.bggId ? (
            <a
              className="text-link"
              href={`https://boardgamegeek.com/boardgame/${game.bggId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {game.title}
            </a>
          ) : (
            game.title
          )}
        </h3>

        <p className="text-xs text-[#1A1A1A]/70">
          {[players && `${players} players`, time, game.year].filter(Boolean).join(' · ')}
        </p>

        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {band && <span className={`pill ${WEIGHT_PILL[band]} !text-[0.7rem] !px-2 !py-0.5`}>{band[0].toUpperCase() + band.slice(1)}</span>}
          {game.rating !== null && <span className="pill !text-[0.7rem] !px-2 !py-0.5">★ {game.rating.toFixed(1)}</span>}
          {game.copies > 1 && <span className="pill pill-cream !text-[0.7rem] !px-2 !py-0.5">{game.copies} copies</span>}
        </div>
      </div>
    </li>
  );
}

export function GameLibrary({ games }: GameLibraryProps) {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const results = useMemo(() => filterGames(games, filters), [games, filters]);

  // Any change to the filters is a new question — start its answer at the top
  // instead of stranding the reader deep in the previous result's tail.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setVisible(PAGE_SIZE);
  }, [filters]);

  const shown = results.slice(0, visible);
  const active = isFiltered(filters);

  // The chip groups run to roughly a phone screen, so on a narrow viewport
  // they fold behind a "Filters" toggle rather than pushing the first game a
  // scroll and a half below the search box. Rendered open, so the filters are
  // there before hydration and for anyone without JS.
  //
  // This tracks the media query rather than measuring once at mount, and
  // forces the panel open above the breakpoint. Both matter: the summary is
  // hidden by CSS at >=640px, so a panel left closed up there would be
  // unreachable — which is exactly what a one-shot check produced whenever the
  // first measurement was wrong (a background tab, or any renderer reporting a
  // zero-width viewport before layout).
  const groupsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 640px)');
    const sync = () => {
      const details = groupsRef.current;
      if (details) details.open = wide.matches;
    };
    sync();
    wide.addEventListener('change', sync);
    return () => wide.removeEventListener('change', sync);
  }, []);

  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div>
      <div className="card-flat p-5" style={{ background: 'var(--color-paper)' }}>
        <div className="mb-5">
          <label htmlFor="library-search" className="label-brutal">
            Search by title
          </label>
          <input
            id="library-search"
            type="search"
            className="input-brutal"
            placeholder="Wingspan, Codenames, Root…"
            value={filters.query}
            onChange={(event) => set('query', event.target.value)}
          />
        </div>

        <details ref={groupsRef} open className="library-filters">
          <summary className="label-brutal library-filters__summary">Filters</summary>
          <div className="grid gap-5 pt-4 sm:grid-cols-2 sm:pt-0">
            <FilterGroup label="Players">
              {PLAYER_COUNTS.map((count) => (
                <Chip
                  key={count}
                  active={filters.players.includes(count)}
                  onClick={() => set('players', toggle(filters.players, count))}
                >
                  {count === 8 ? '8+' : count}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup label="Length">
              {DURATION_BANDS.map((band) => (
                <Chip
                  key={band.id}
                  active={filters.durations.includes(band.id)}
                  onClick={() => set('durations', toggle<DurationBand>(filters.durations, band.id))}
                >
                  {band.label}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup label="Complexity">
              {WEIGHT_BANDS.map((band) => (
                <Chip
                  key={band.id}
                  active={filters.weights.includes(band.id)}
                  onClick={() => set('weights', toggle<WeightBand>(filters.weights, band.id))}
                >
                  {band.label}
                </Chip>
              ))}
            </FilterGroup>
          </div>
        </details>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <p role="status" aria-live="polite" className="font-semibold">
          {results.length === games.length
            ? `${games.length} games`
            : `${results.length} of ${games.length} games`}
        </p>
        {active && (
          <button type="button" className="text-link cursor-pointer bg-transparent" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <p className="notice mt-6">
          Nothing on the shelf matches that yet. Try clearing a filter — or ask at the library desk, the list is a
          snapshot and people bring extras.
        </p>
      ) : (
        <>
          <ul className="mt-6 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {shown.map((game) => (
              <GameCard key={game.key} game={game} />
            ))}
          </ul>

          {visible < results.length && (
            <div className="mt-8 flex justify-center">
              <button type="button" className="btn btn-secondary" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, results.length - visible)} more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default GameLibrary;
