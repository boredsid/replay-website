// Pure logic behind the venue projector at /floor-display.
//
// Everything that decides *what* the screen says lives here, so it can be
// tested at any moment of the weekend without a browser or a clock: what is on
// now, what is next, which state the day is in, how a stat is phrased, and how
// a burst of arrivals becomes banners. `FloorDisplay.tsx` only renders it.
//
// All times are Bengaluru time. The projector laptop's own timezone is never
// consulted, so a machine left on UTC still shows the right programme.

const IST_OFFSET_MS = 330 * 60 * 1000;

export interface FeedScheduleItem {
  id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  location: string | null;
  kind: string;
  section: string;
  is_all_day: boolean;
  host_name: string | null;
  public_status: 'published' | 'cancelled';
  display_order: number;
}

export interface FeedAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'urgent' | 'incident';
  starts_at: string;
  ends_at: string | null;
  updated_at: string;
}

export interface WindowCounts {
  last_1h: number;
  last_2h: number;
  last_3h: number;
  today: number;
  total: number;
}

export interface FeedStats {
  checked_in_today: number;
  checked_in_total: number;
  arrivals: WindowCounts;
  loans: WindowCounts;
  games_out_now: number;
  top_game_today: { title: string; count: number } | null;
  bookings: WindowCounts;
}

export interface FeedEdition {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  daily_start_time: string | null;
  daily_end_time: string | null;
}

export interface DisplayFeed {
  generated_at: string;
  names_enabled: boolean;
  edition: FeedEdition | null;
  day?: 'day1' | 'day2' | null;
  schedule: FeedScheduleItem[];
  announcements: FeedAnnouncement[];
  arrivals: Array<{ id: string; name: string; at: string }>;
  stats: FeedStats | null;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export interface IstClock {
  /** YYYY-MM-DD in Bengaluru. */
  date: string;
  /** Minutes since Bengaluru midnight, fractional. */
  minutes: number;
}

export function istClock(now: Date): IstClock {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60,
  };
}

/** "14:30:00" → 870. */
export function toMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** 870 → "2:30 PM"; whole hours drop the minutes ("3 PM"). */
export function formatTime(minutes: number, { compact = true } = {}): string {
  const total = Math.round(minutes);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (compact && m === 0) return `${h12} ${suffix}`;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 95 → "1h 35m", 40 → "40 min". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.ceil(minutes));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * `?at=2026-09-12T14:30` — pretend it is that moment in Bengaluru, and keep
 * the clock running from there. Anything unparseable is ignored.
 */
export function mockOffset(param: string | null, realNow: number): number {
  if (!param) return 0;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(param) ? param : `${param}+05:30`;
  const target = Date.parse(withZone);
  return Number.isNaN(target) ? 0 : target - realNow;
}

// ---------------------------------------------------------------------------
// Day phase
// ---------------------------------------------------------------------------

export type Phase =
  /** No current edition, or the feed has not loaded yet. */
  | { kind: 'idle' }
  /** Days before the event. */
  | { kind: 'countdown'; days: number }
  /** An event day, before doors. */
  | { kind: 'pre-doors'; minutesToOpen: number; dayNumber: 1 | 2 }
  | { kind: 'live'; dayNumber: 1 | 2 }
  /** After close on day one. */
  | { kind: 'overnight' }
  /** After close on the final day. */
  | { kind: 'wrapped' };

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function phaseAt(edition: FeedEdition | null, clock: IstClock): Phase {
  if (!edition) return { kind: 'idle' };
  const open = toMinutes(edition.daily_start_time) ?? 9 * 60;
  const close = toMinutes(edition.daily_end_time) ?? 21 * 60;
  const isDay1 = clock.date === edition.start_date;
  const isDay2 = clock.date === edition.end_date && edition.end_date !== edition.start_date;

  if (clock.date < edition.start_date) return { kind: 'countdown', days: daysBetween(clock.date, edition.start_date) };
  if (clock.date > edition.end_date) return { kind: 'wrapped' };

  const dayNumber: 1 | 2 = isDay2 ? 2 : 1;
  if (clock.minutes < open) return { kind: 'pre-doors', minutesToOpen: open - clock.minutes, dayNumber };
  if (clock.minutes < close) return { kind: 'live', dayNumber };
  return isDay1 && edition.end_date !== edition.start_date ? { kind: 'overnight' } : { kind: 'wrapped' };
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------

export interface LiveItem extends FeedScheduleItem {
  start: number;
  end: number;
  /** 0..1 through the session. */
  progress: number;
  minutesLeft: number;
}

export interface UpcomingItem extends FeedScheduleItem {
  start: number;
  end: number | null;
  minutesUntil: number;
}

export interface Programme {
  live: LiveItem[];
  next: UpcomingItem[];
  allDay: FeedScheduleItem[];
}

/** How far ahead "Up next" looks. Past this the list would just be the afternoon. */
export const NEXT_WINDOW_MINUTES = 120;

export function programmeAt(schedule: FeedScheduleItem[], clock: IstClock, windowMinutes = NEXT_WINDOW_MINUTES): Programme {
  const today = schedule.filter((item) => item.day === clock.date);
  const live: LiveItem[] = [];
  const next: UpcomingItem[] = [];
  const allDay: FeedScheduleItem[] = [];

  for (const item of today) {
    if (item.is_all_day) {
      if (item.public_status === 'published') allDay.push(item);
      continue;
    }
    const start = toMinutes(item.start_time);
    if (start === null) continue;
    const end = toMinutes(item.end_time);

    if (start > clock.minutes) {
      if (start - clock.minutes <= windowMinutes) {
        next.push({ ...item, start, end, minutesUntil: start - clock.minutes });
      }
      continue;
    }
    // A cancelled session is news before it starts, not while it would be running.
    if (item.public_status !== 'published' || end === null || end <= clock.minutes) continue;
    const span = Math.max(1, end - start);
    live.push({
      ...item,
      start,
      end,
      progress: Math.min(1, Math.max(0, (clock.minutes - start) / span)),
      minutesLeft: end - clock.minutes,
    });
  }

  // Most recently started first — the thing someone just heard announced sits
  // at the top — then by title so the order is stable across refreshes.
  live.sort((a, b) => b.start - a.start || a.title.localeCompare(b.title));
  next.sort((a, b) => a.start - b.start || a.display_order - b.display_order || a.title.localeCompare(b.title));
  allDay.sort((a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title));
  return { live, next, allDay };
}

/** The first timed session of a day, for the pre-doors screen. */
export function firstSessionOf(schedule: FeedScheduleItem[], date: string): { title: string; start: number } | null {
  let best: { title: string; start: number } | null = null;
  for (const item of schedule) {
    if (item.day !== date || item.is_all_day || item.public_status !== 'published') continue;
    const start = toMinutes(item.start_time);
    if (start !== null && (!best || start < best.start)) best = { title: item.title, start };
  }
  return best;
}

/** Split a list into pages and return the one showing at `tick`. */
export function pageAt<T>(items: T[], size: number, tick: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = ((tick % pages) + pages) % pages;
  return { items: items.slice(page * size, page * size + size), page, pages };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatLine {
  id: string;
  value: string;
  text: string;
}

const WINDOWS: Array<[keyof WindowCounts, string]> = [
  ['last_1h', 'in the last hour'],
  ['last_2h', 'in the last 2 hours'],
  ['last_3h', 'in the last 3 hours'],
];

/**
 * The tightest window that still sounds busy. "4 games in the last hour"
 * reads livelier than "4 games in the last 3 hours"; "1 game in the last hour"
 * reads dead, so a window has to clear `min` before it is quoted at all.
 */
function windowPhrase(counts: WindowCounts, min: number): { value: number; when: string } | null {
  for (const [key, when] of WINDOWS) {
    if (counts[key] >= min) return { value: counts[key], when };
  }
  if (counts.today >= min) return { value: counts.today, when: 'today' };
  return null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function statLines(stats: FeedStats | null, live: boolean): StatLine[] {
  if (!stats) return [];
  const lines: StatLine[] = [];

  if (live) {
    const loans = windowPhrase(stats.loans, 3);
    if (loans) lines.push({ id: 'loans', value: String(loans.value), text: `games borrowed from the library ${loans.when}` });

    if (stats.games_out_now >= 2) {
      lines.push({ id: 'out', value: String(stats.games_out_now), text: 'library games on the tables right now' });
    }

    if (stats.top_game_today && stats.top_game_today.count >= 2) {
      lines.push({
        id: 'top',
        value: `${stats.top_game_today.count}×`,
        text: `${stats.top_game_today.title} is today’s most-borrowed game`,
      });
    }

    const arrivals = windowPhrase(stats.arrivals, 5);
    if (arrivals && arrivals.when !== 'today') {
      lines.push({ id: 'arrivals', value: String(arrivals.value), text: `players through the door ${arrivals.when}` });
    }
    if (stats.checked_in_today >= 1) {
      lines.push({
        id: 'today',
        value: String(stats.checked_in_today),
        text: `${plural(stats.checked_in_today, 'player', 'players')} at REPLAY today`,
      });
    }
  }

  const bookings = windowPhrase(stats.bookings, 3);
  if (bookings && bookings.when !== 'today') {
    lines.push({ id: 'bookings', value: String(bookings.value), text: `session seats booked ${bookings.when}` });
  }
  if (stats.bookings.total >= 1) {
    lines.push({
      id: 'booked-total',
      value: String(stats.bookings.total),
      text: `${plural(stats.bookings.total, 'seat', 'seats')} booked across this weekend’s sessions`,
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Arrivals
// ---------------------------------------------------------------------------

export const ARRIVAL_LINES: Array<(name: string) => string> = [
  (n) => `${n} is in da house!`,
  (n) => `${n} is in da house!`,
  (n) => `${n} has entered the game!`,
  (n) => `A wild ${n} appears!`,
  (n) => `${n} rolled a natural 20 on arrival!`,
  (n) => `Player ${n} has joined the table!`,
  (n) => `${n} passed GO. Collect 200 fun.`,
  (n) => `Make some room — ${n} is here!`,
  (n) => `${n} drew the “Show up at REPLAY” card!`,
  (n) => `Everybody say hi to ${n}!`,
  (n) => `${n} has spawned. Let the games begin!`,
];

export const GROUP_LINES: Array<(names: string) => string> = [
  (n) => `${n} are in da house!`,
  (n) => `${n} just rolled in!`,
  (n) => `${n} have entered the game!`,
  (n) => `Party of players: ${n}!`,
];

export const CROWD_LINES: Array<(names: string, others: number) => string> = [
  (n, k) => `${n} and ${k} others are in da house!`,
  (n, k) => `${n} and ${k} more just rolled in!`,
  (n, k) => `The doors are busy: ${n} and ${k} others just arrived!`,
];

export interface Banner {
  names: string[];
  message: string;
}

const pick = <T>(list: T[], rand: () => number): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * Turn the head of the arrival queue into one banner.
 *
 * One or two waiting: greet the first by name. Three: greet them together. A
 * door rush: name the first two and count the rest — at 9 AM on day one a
 * banner per person would still be scrolling at lunch.
 */
export function nextBanner(queue: string[], rand: () => number = Math.random): { banner: Banner; rest: string[] } | null {
  if (queue.length === 0) return null;
  if (queue.length <= 2) {
    const [name, ...rest] = queue;
    return { banner: { names: [name], message: pick(ARRIVAL_LINES, rand)(name) }, rest };
  }
  if (queue.length === 3) {
    return { banner: { names: queue, message: pick(GROUP_LINES, rand)(joinNames(queue)) }, rest: [] };
  }
  const named = queue.slice(0, 2);
  return {
    banner: { names: queue, message: pick(CROWD_LINES, rand)(named.join(', '), queue.length - 2) },
    rest: [],
  };
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

/** Fisher–Yates with an injectable source of randomness. */
export function shuffled<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
