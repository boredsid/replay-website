import { describe, expect, it } from 'vitest';
import {
  firstSessionOf,
  formatDuration,
  formatTime,
  istClock,
  mockOffset,
  nextBanner,
  pageAt,
  phaseAt,
  programmeAt,
  shuffled,
  statLines,
  type FeedEdition,
  type FeedScheduleItem,
  type FeedStats,
} from './floor-display';

const edition: FeedEdition = {
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  daily_start_time: '09:00:00',
  daily_end_time: '21:00:00',
};

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { date, minutes: h * 60 + m };
};

function item(id: string, start: string | null, end: string | null, extra: Partial<FeedScheduleItem> = {}): FeedScheduleItem {
  return {
    id,
    day: '2026-09-12',
    start_time: start,
    end_time: end,
    title: id,
    location: 'Spotlight',
    kind: 'ttrpg',
    section: 'programme',
    is_all_day: false,
    host_name: null,
    public_status: 'published',
    display_order: 0,
    ...extra,
  };
}

describe('clock helpers', () => {
  it('reads Bengaluru time regardless of the machine', () => {
    expect(istClock(new Date('2026-09-12T08:30:15.000Z'))).toEqual({ date: '2026-09-12', minutes: 14 * 60 + 0.25 });
    expect(istClock(new Date('2026-09-11T20:00:00.000Z')).date).toBe('2026-09-12');
  });

  it('formats times and durations for a room to read', () => {
    expect(formatTime(15 * 60)).toBe('3 PM');
    expect(formatTime(9 * 60 + 5)).toBe('9:05 AM');
    expect(formatTime(12 * 60 + 30)).toBe('12:30 PM');
    expect(formatTime(0)).toBe('12 AM');
    expect(formatDuration(40)).toBe('40 min');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(95)).toBe('1h 35m');
  });

  it('treats a zoneless ?at= as Bengaluru time', () => {
    const real = Date.parse('2026-09-11T00:00:00Z');
    expect(real + mockOffset('2026-09-12T14:30', real)).toBe(Date.parse('2026-09-12T09:00:00Z'));
    expect(mockOffset('nonsense', real)).toBe(0);
    expect(mockOffset(null, real)).toBe(0);
  });
});

describe('phaseAt', () => {
  it('walks through the weekend', () => {
    expect(phaseAt(null, at('2026-09-12', '10:00'))).toEqual({ kind: 'idle' });
    expect(phaseAt(edition, at('2026-09-10', '18:00'))).toEqual({ kind: 'countdown', days: 2 });
    expect(phaseAt(edition, at('2026-09-12', '08:30'))).toEqual({ kind: 'pre-doors', minutesToOpen: 30, dayNumber: 1 });
    expect(phaseAt(edition, at('2026-09-12', '09:00'))).toEqual({ kind: 'live', dayNumber: 1 });
    expect(phaseAt(edition, at('2026-09-12', '21:00'))).toEqual({ kind: 'overnight' });
    expect(phaseAt(edition, at('2026-09-13', '07:00'))).toMatchObject({ kind: 'pre-doors', dayNumber: 2 });
    expect(phaseAt(edition, at('2026-09-13', '20:59'))).toEqual({ kind: 'live', dayNumber: 2 });
    expect(phaseAt(edition, at('2026-09-13', '21:30'))).toEqual({ kind: 'wrapped' });
    expect(phaseAt(edition, at('2026-09-14', '10:00'))).toEqual({ kind: 'wrapped' });
  });
});

describe('programmeAt', () => {
  const schedule = [
    item('early', '10:00:00', '14:00:00'),
    item('late-start', '13:00:00', '17:00:00'),
    item('finished', '10:00:00', '12:00:00'),
    item('soon', '15:00:00', '17:00:00'),
    item('much-later', '18:00:00', '20:00:00'),
    item('cancelled-soon', '14:30:00', '16:00:00', { public_status: 'cancelled' }),
    item('cancelled-now', '13:00:00', '16:00:00', { public_status: 'cancelled' }),
    item('all-day', null, null, { is_all_day: true }),
    item('sunday', '13:00:00', '17:00:00', { day: '2026-09-13' }),
  ];

  it('splits today into live, next and all-day', () => {
    const { live, next, allDay } = programmeAt(schedule, at('2026-09-12', '14:00'));
    expect(live.map((i) => i.id)).toEqual(['late-start']);
    expect(next.map((i) => i.id)).toEqual(['cancelled-soon', 'soon']);
    expect(allDay.map((i) => i.id)).toEqual(['all-day']);
  });

  it('reports progress and time left', () => {
    const { live } = programmeAt(schedule, at('2026-09-12', '12:00'));
    const early = live.find((i) => i.id === 'early')!;
    expect(early.progress).toBeCloseTo(0.5);
    expect(early.minutesLeft).toBe(120);
    // Most recently started first.
    expect(live.map((i) => i.id)).toEqual(['early']);
  });

  it('finds the first session of a day', () => {
    expect(firstSessionOf(schedule, '2026-09-12')).toEqual({ title: 'early', start: 600 });
    expect(firstSessionOf(schedule, '2026-09-14')).toBeNull();
  });

  it('pages long lists and wraps around', () => {
    const list = [1, 2, 3, 4, 5];
    expect(pageAt(list, 2, 0)).toEqual({ items: [1, 2], page: 0, pages: 3 });
    expect(pageAt(list, 2, 2)).toEqual({ items: [5], page: 2, pages: 3 });
    expect(pageAt(list, 2, 3).page).toBe(0);
    expect(pageAt([], 2, 7)).toEqual({ items: [], page: 0, pages: 1 });
  });
});

describe('statLines', () => {
  const zero = { last_1h: 0, last_2h: 0, last_3h: 0, today: 0, total: 0 };
  const stats: FeedStats = {
    checked_in_today: 212,
    checked_in_total: 212,
    arrivals: { last_1h: 2, last_2h: 40, last_3h: 90, today: 212, total: 212 },
    loans: { last_1h: 1, last_2h: 2, last_3h: 7, today: 12, total: 12 },
    games_out_now: 9,
    top_game_today: { title: 'Cascadia', count: 4 },
    bookings: { last_1h: 5, last_2h: 8, last_3h: 9, today: 30, total: 310 },
  };

  it('quotes the tightest window that sounds busy', () => {
    const lines = statLines(stats, true);
    expect(lines).toContainEqual({ id: 'loans', value: '7', text: 'games borrowed from the library in the last 3 hours' });
    expect(lines).toContainEqual({ id: 'arrivals', value: '40', text: 'players through the door in the last 2 hours' });
    expect(lines).toContainEqual({ id: 'bookings', value: '5', text: 'session seats booked in the last hour' });
    expect(lines.find((l) => l.id === 'top')?.text).toBe('Cascadia is today’s most-borrowed game');
  });

  it('keeps floor stats off the screen outside opening hours', () => {
    expect(statLines(stats, false).map((l) => l.id)).toEqual(['bookings', 'booked-total']);
  });

  it('says nothing rather than something sad', () => {
    const quiet: FeedStats = { ...stats, checked_in_today: 0, arrivals: zero, loans: { ...zero, today: 1, total: 1 }, games_out_now: 1, top_game_today: { title: 'Azul', count: 1 }, bookings: zero };
    expect(statLines(quiet, true)).toEqual([]);
    expect(statLines(null, true)).toEqual([]);
  });
});

describe('nextBanner', () => {
  const first = () => 0;

  it('greets one person at a time while the door is calm', () => {
    const result = nextBanner(['Priya', 'Arjun'], first)!;
    expect(result.banner).toEqual({ names: ['Priya'], message: 'Priya is in da house!' });
    expect(result.rest).toEqual(['Arjun']);
  });

  it('greets three together', () => {
    const result = nextBanner(['Priya', 'Arjun', 'Meera'], first)!;
    expect(result.banner.message).toBe('Priya, Arjun & Meera are in da house!');
    expect(result.rest).toEqual([]);
  });

  it('collapses a door rush into one banner', () => {
    const result = nextBanner(['A', 'B', 'C', 'D', 'E'], first)!;
    expect(result.banner.message).toBe('A, B and 3 others are in da house!');
    expect(result.banner.names).toHaveLength(5);
    expect(result.rest).toEqual([]);
  });

  it('varies the line with randomness', () => {
    const lines = new Set(Array.from({ length: 11 }, (_, i) => nextBanner(['Sam'], () => i / 11)!.banner.message));
    expect(lines.size).toBeGreaterThan(5);
    expect(nextBanner([], first)).toBeNull();
  });
});

describe('shuffled', () => {
  it('keeps every item exactly once', () => {
    const out = shuffled([1, 2, 3, 4, 5], () => 0.3);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
