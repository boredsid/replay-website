import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Clock, Search } from 'lucide-react';
// The same pure helpers the public /library page uses, so the two cannot drift
// into disagreeing about what "light" or "under 30 min" means.
import {
  DURATION_BANDS,
  EMPTY_FILTERS,
  PLAYER_COUNTS,
  WEIGHT_BANDS,
  filterGames,
  formatPlayers,
  formatTime,
  isFiltered,
  weightBand,
  type DurationBand,
  type LibraryFilters,
  type LibraryGame,
  type WeightBand,
} from '../../../src/lib/game-library';
import type { Device } from '../lib/device';
import {
  cancelRequest,
  dueLabel,
  minutesLeft,
  requestErrorMessage,
  requestGame,
  type LibraryState,
} from '../lib/library';

export type CatalogueGame = LibraryGame;

/**
 * Rendering 586 rows costs more than anyone gains from scrolling them. The cap
 * is a prompt to narrow the question rather than a limit on the shelf.
 */
const MAX_ROWS = 60;

/** Honours a reduced-motion preference, which a jump to the top otherwise ignores. */
function scrollToTop(): void {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
}

/** Add or remove a value — chips toggle, they do not cycle. */
function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

interface Props {
  device: Device | null;
  state: LibraryState | null;
  catalogue: CatalogueGame[] | null;
  catalogueError: boolean;
  onChanged: () => void;
  onFinishSetup: () => void;
}

export default function LibraryView({
  device, state, catalogue, catalogueError, onChanged, onFinishSetup,
}: Props) {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Hides the hold card the moment it is given up, rather than after two
  // network round trips. The prop stays the truth; this only runs ahead of it.
  const [cancelling, setCancelling] = useState(false);
  // Ticks the countdown without re-fetching. A hold is five minutes long and
  // watching a number that does not move is worse than no number.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state?.hold) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.hold]);

  useEffect(() => { if (!state?.hold) setCancelling(false); }, [state?.hold]);

  const unavailable = useMemo(() => new Set(state?.unavailable ?? []), [state?.unavailable]);

  const matches = useMemo(
    () => (catalogue ? filterGames(catalogue, filters) : []),
    [catalogue, filters],
  );
  const results = useMemo(() => matches.slice(0, MAX_ROWS), [matches]);

  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const request = async (titleKey: string) => {
    if (!device) return;
    setBusy(true);
    setNote(null);
    const result = await requestGame(device, titleKey);
    setBusy(false);
    if (!result.ok) { setNote(requestErrorMessage(result.error)); return; }
    onChanged();
    // The card that says where to go and how long you have appears at the top,
    // and a reservation made from row forty is otherwise made into the void.
    scrollToTop();
  };

  const giveUp = async () => {
    if (!device) return;
    // Optimistic: the card goes now. Waiting for the cancel and then a refetch
    // means watching a card you have already dismissed sit there for two round
    // trips, which reads as the tap not having registered.
    setCancelling(true);
    const ok = await cancelRequest(device);
    if (!ok) {
      setCancelling(false);
      setNote('That did not go through. Your game is still held.');
      return;
    }
    onChanged();
  };

  if (!device) {
    return (
      <>
        <header className="screen-header">
          <span className="eyebrow">Game library</span>
          <h1>869 copies on the shelf</h1>
          <p>
            Check in at the desk and finish setup, then you can reserve a game
            from here and collect it at the library.
          </p>
        </header>
        <section className="screen-section">
          <button type="button" className="button button--dark" onClick={onFinishSetup}>
            Finish setup
          </button>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="screen-header">
        <span className="eyebrow">Game library</span>
        <h1>Borrow a game</h1>
        <p>Reserve one here, then show your ID at the library counter.</p>
      </header>

      {note && (
        <p className="booking-note" role="status">
          {note}
          <button type="button" className="text-button" onClick={() => setNote(null)}>Dismiss</button>
        </p>
      )}

      {state?.loan && (
        <section className="library-card library-card--loan" aria-label="Game you have out">
          <span className="eyebrow">You have</span>
          <h2>{state.loan.title}</h2>
          <p className={state.loan.overdue ? 'library-card__due library-card__due--over' : 'library-card__due'}>
            <Clock size={15} strokeWidth={2.5} aria-hidden="true" />
            {state.loan.overdue ? 'Due back now' : dueLabel(state.loan.due_at, now)}
          </p>
          <p className="library-card__hint">Bring it back to the library counter to borrow another.</p>
        </section>
      )}

      {state?.hold && !state.loan && !cancelling && (
        <section className="library-card library-card--hold" aria-label="Game you have reserved">
          <span className="eyebrow">Held for you</span>
          <h2>{state.hold.title}</h2>
          <p className="library-card__due" role="status">
            <Clock size={15} strokeWidth={2.5} aria-hidden="true" />
            {minutesLeft(state.hold.expires_at, now) > 0
              ? `${minutesLeft(state.hold.expires_at, now)} min to collect it`
              : 'Time is up — but if it is still on the shelf, the desk can hand it over'}
          </p>
          <p className="library-card__hint">Show your ID at the library counter.</p>
          <button type="button" className="button button--light" onClick={() => void giveUp()} disabled={busy}>
            Change my mind
          </button>
        </section>
      )}

      {state && !state.can_borrow && !state.loan && (
        <p className="booking-note" role="status">
          Check in at the desk before borrowing. Browsing works either way.
        </p>
      )}

      <section className="screen-section" aria-label="Browse the shelf">
        {/* Without this the whole shelf reads "Available" with no button and no
            reason, which looks like the app is broken rather than like a rule. */}
        {state?.loan && (
          <p className="library-blocked" role="status">
            Bring {state.loan.title} back before borrowing another.
          </p>
        )}
        {state?.hold && !state.loan && !cancelling && (
          <p className="library-blocked" role="status">
            {state.hold.title} is held for you — collect it, or change your mind above.
          </p>
        )}

        <div className="library-filters">
          <label className="library-filters__search">
            <span className="eyebrow">Search</span>
            <span className="library-filters__field">
              <Search size={16} strokeWidth={2.5} aria-hidden="true" />
              <input
                type="search"
                value={filters.query}
                onChange={(event) => set('query', event.target.value)}
                placeholder="Game name…"
                autoComplete="off"
              />
            </span>
          </label>

          <fieldset className="library-chips">
            <legend className="eyebrow">Players</legend>
            {PLAYER_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className={`library-chip ${filters.players.includes(count) ? 'library-chip--on' : ''}`}
                aria-pressed={filters.players.includes(count)}
                onClick={() => set('players', toggle(filters.players, count))}
              >
                {count}
              </button>
            ))}
          </fieldset>

          <fieldset className="library-chips">
            <legend className="eyebrow">How long</legend>
            {DURATION_BANDS.map((band) => (
              <button
                key={band.id}
                type="button"
                className={`library-chip ${filters.durations.includes(band.id) ? 'library-chip--on' : ''}`}
                aria-pressed={filters.durations.includes(band.id)}
                onClick={() => set('durations', toggle<DurationBand>(filters.durations, band.id))}
              >
                {band.label}
              </button>
            ))}
          </fieldset>

          <fieldset className="library-chips">
            <legend className="eyebrow">How heavy</legend>
            {WEIGHT_BANDS.map((band) => (
              <button
                key={band.id}
                type="button"
                className={`library-chip ${filters.weights.includes(band.id) ? 'library-chip--on' : ''}`}
                aria-pressed={filters.weights.includes(band.id)}
                onClick={() => set('weights', toggle<WeightBand>(filters.weights, band.id))}
              >
                {band.label}
              </button>
            ))}
          </fieldset>

          {isFiltered(filters) && (
            <p className="library-filters__count">
              {matches.length} game{matches.length === 1 ? '' : 's'}
              <button type="button" className="text-button" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            </p>
          )}
        </div>

        {catalogueError ? (
          <p className="library-empty">
            The catalogue could not be loaded. Connect once and it will be saved
            to this device.
          </p>
        ) : !catalogue ? (
          <p className="library-empty">Loading the shelf…</p>
        ) : results.length === 0 ? (
          <p className="library-empty">
            Nothing on the shelf matches that. Try clearing a filter.
          </p>
        ) : (
          <ul className="library-list">
            {results.map((game) => {
              const out = unavailable.has(game.key);
              // One game at a time: holding or borrowing anything rules out
              // asking for something else, and the card should say so rather
              // than offering a button that will be refused.
              const blocked = Boolean(state?.hold || state?.loan) || !state?.can_borrow;
              const open = openKey === game.key;
              return (
                <li key={game.key} className={`library-item ${out ? 'library-item--out' : ''} ${open ? 'library-item--open' : ''}`}>
                  <button
                    type="button"
                    className="library-item__body"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : game.key)}
                  >
                    <span>
                      <h3>{game.title}</h3>
                      <span className="library-item__meta">
                        {[formatPlayers(game), formatTime(game)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronDown
                      className={`library-item__chevron ${open ? 'library-item__chevron--open' : ''}`}
                      size={16}
                      aria-hidden="true"
                    />
                  </button>
                  {out ? (
                    <span className="library-item__status">All out</span>
                  ) : blocked ? (
                    <span className="library-item__status">Available</span>
                  ) : (
                    <button
                      type="button"
                      className="save-button save-button--book"
                      disabled={busy}
                      onClick={() => void request(game.key)}
                      aria-label={`Reserve ${game.title}`}
                    >
                      Reserve
                    </button>
                  )}
                  {open && <GameDetail game={game} />}
                </li>
              );
            })}
            {matches.length > MAX_ROWS && (
              <li className="library-list__more">
                <BookOpen size={15} aria-hidden="true" />
                Showing {MAX_ROWS} of {matches.length}. Narrow it down to see the rest.
              </li>
            )}
          </ul>
        )}
      </section>
    </>
  );
}


/** What a game is, once somebody taps to ask. */
function GameDetail({ game }: { game: LibraryGame }) {
  const facts: Array<[string, string]> = [];
  if (game.year) facts.push(['Published', String(game.year)]);
  if (game.rating) facts.push(['BGG rating', game.rating.toFixed(1)]);
  const heaviness = weightBand(game.weight);
  if (heaviness) {
    facts.push(['Weight', `${heaviness[0].toUpperCase()}${heaviness.slice(1)}${game.weight ? ` (${game.weight.toFixed(1)}/5)` : ''}`]);
  }
  if (game.bestWith?.length) facts.push(['Best with', `${game.bestWith.join(', ')} players`]);
  facts.push(['On the shelf', `${game.copies} cop${game.copies === 1 ? 'y' : 'ies'}`]);

  return (
    <div className="library-detail">
      {game.thumb && (
        <img
          className="library-detail__thumb"
          src={game.thumb}
          alt=""
          /* Lazy, because the shelf renders sixty rows and almost none of them
             get opened. The venue network should not pay for the other 59. */
          loading="lazy"
          decoding="async"
          width={120}
        />
      )}
      {game.description && <p className="library-detail__blurb">{game.description}</p>}
      <dl className="library-detail__facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {game.bggId && (
        <a
          className="text-button"
          href={`https://boardgamegeek.com/boardgame/${game.bggId}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Read more on BoardGameGeek
        </a>
      )}
    </div>
  );
}
