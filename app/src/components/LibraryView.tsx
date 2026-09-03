import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Clock, Search } from 'lucide-react';
import type { Device } from '../lib/device';
import {
  cancelRequest,
  dueLabel,
  minutesLeft,
  requestErrorMessage,
  requestGame,
  type LibraryState,
} from '../lib/library';

/** The fields of the catalogue snapshot this screen actually uses. */
export interface CatalogueGame {
  key: string;
  title: string;
  minPlayers: number | null;
  maxPlayers: number | null;
  minTime: number | null;
  maxTime: number | null;
  weight: number | null;
}

/**
 * Rendering 586 rows costs more than anyone gains from scrolling them. The cap
 * is a prompt to type something rather than a limit on the shelf.
 */
const MAX_ROWS = 60;

function playersLabel(game: CatalogueGame): string {
  if (game.minPlayers === null && game.maxPlayers === null) return '';
  if (game.minPlayers === game.maxPlayers) return `${game.minPlayers}p`;
  return `${game.minPlayers ?? '?'}–${game.maxPlayers ?? '?'}p`;
}

function timeLabel(game: CatalogueGame): string {
  if (!game.maxTime) return '';
  return game.minTime && game.minTime !== game.maxTime
    ? `${game.minTime}–${game.maxTime} min`
    : `${game.maxTime} min`;
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
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Ticks the countdown without re-fetching. A hold is five minutes long and
  // watching a number that does not move is worse than no number.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state?.hold) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.hold]);

  const unavailable = useMemo(() => new Set(state?.unavailable ?? []), [state?.unavailable]);

  const results = useMemo(() => {
    if (!catalogue) return [];
    const needle = query.trim().toLowerCase();
    const count = players ? Number(players) : null;
    return catalogue
      .filter((game) => {
        if (needle && !game.title.toLowerCase().includes(needle)) return false;
        if (count !== null) {
          if (game.minPlayers !== null && count < game.minPlayers) return false;
          if (game.maxPlayers !== null && count > game.maxPlayers) return false;
        }
        return true;
      })
      .slice(0, MAX_ROWS);
  }, [catalogue, query, players]);

  const request = async (titleKey: string) => {
    if (!device) return;
    setBusy(true);
    setNote(null);
    const result = await requestGame(device, titleKey);
    setBusy(false);
    if (!result.ok) { setNote(requestErrorMessage(result.error)); return; }
    onChanged();
  };

  const giveUp = async () => {
    if (!device) return;
    setBusy(true);
    await cancelRequest(device);
    setBusy(false);
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

      {state?.hold && !state.loan && (
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
        <div className="library-filters">
          <label className="library-filters__search">
            <span className="eyebrow">Search</span>
            <span className="library-filters__field">
              <Search size={16} strokeWidth={2.5} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Game name…"
                autoComplete="off"
              />
            </span>
          </label>
          <label>
            <span className="eyebrow">Players</span>
            <select value={players} onChange={(event) => setPlayers(event.target.value)}>
              <option value="">Any</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} player{n === 1 ? '' : 's'}</option>
              ))}
            </select>
          </label>
        </div>

        {catalogueError ? (
          <p className="library-empty">
            The catalogue could not be loaded. Connect once and it will be saved
            to this device.
          </p>
        ) : !catalogue ? (
          <p className="library-empty">Loading the shelf…</p>
        ) : results.length === 0 ? (
          <p className="library-empty">No game matches that. Try a shorter search.</p>
        ) : (
          <ul className="library-list">
            {results.map((game) => {
              const out = unavailable.has(game.key);
              // One game at a time: holding or borrowing anything rules out
              // asking for something else, and the card should say so rather
              // than offering a button that will be refused.
              const blocked = Boolean(state?.hold || state?.loan) || !state?.can_borrow;
              return (
                <li key={game.key} className={`library-item ${out ? 'library-item--out' : ''}`}>
                  <div className="library-item__body">
                    <h3>{game.title}</h3>
                    <p className="library-item__meta">
                      {[playersLabel(game), timeLabel(game)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
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
                </li>
              );
            })}
            {catalogue.length > MAX_ROWS && results.length === MAX_ROWS && (
              <li className="library-list__more">
                <BookOpen size={15} aria-hidden="true" />
                Showing the first {MAX_ROWS}. Search to narrow it down.
              </li>
            )}
          </ul>
        )}
      </section>
    </>
  );
}
