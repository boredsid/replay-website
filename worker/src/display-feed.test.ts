import { describe, expect, it, vi } from 'vitest';
import {
  buildDisplayFeed,
  countWindows,
  dayKeyFor,
  displayKeyPresented,
  firstArrivals,
  firstName,
  handleDisplayFeed,
  istDate,
  topTitle,
  type CheckInRow,
} from './display-feed';

/** A query builder whose every step chains and which resolves to `result` when awaited. */
function query(result: any) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'in', 'lte', 'or', 'order', 'not', 'neq', 'limit']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const ok = (data: any) => ({ data, error: null });

function client(tables: Record<string, any>) {
  const queries: Record<string, any> = {};
  const from = vi.fn((table: string) => {
    if (!(table in tables)) throw new Error(`unexpected table ${table}`);
    queries[table] = query(tables[table]);
    return queries[table];
  });
  return { sb: { from } as any, from, queries };
}

const edition = {
  id: 'ed-1',
  slug: 'replay-3',
  name: 'REPLAY',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  daily_start_time: '09:00:00',
  daily_end_time: '21:00:00',
};

// 14:00 IST on day one.
const NOW = new Date('2026-09-12T08:30:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function event(id: string, attendee: string, minutes: number, extra: Partial<CheckInRow> = {}): CheckInRow {
  return { id, attendee_id: attendee, day: 'day1', kind: 'in', voids_event_id: null, occurred_at: minutesAgo(minutes), ...extra };
}

describe('time helpers', () => {
  it('reads the calendar day in Bengaluru, not UTC', () => {
    // 23:00 UTC on the 11th is 04:30 IST on the 12th.
    expect(istDate(new Date('2026-09-11T23:00:00.000Z'))).toBe('2026-09-12');
  });

  it('maps today onto the edition day it falls on', () => {
    expect(dayKeyFor(edition, NOW)).toBe('day1');
    expect(dayKeyFor(edition, new Date('2026-09-13T04:00:00.000Z'))).toBe('day2');
    expect(dayKeyFor(edition, new Date('2026-09-11T04:00:00.000Z'))).toBeNull();
  });

  it('buckets timestamps into rolling windows and the IST day', () => {
    const counts = countWindows(
      [minutesAgo(10), minutesAgo(90), minutesAgo(150), minutesAgo(400), '2026-09-11T10:00:00.000Z', null, minutesAgo(-5)],
      NOW,
    );
    expect(counts).toEqual({ last_1h: 1, last_2h: 2, last_3h: 3, today: 4, total: 5 });
  });
});

describe('firstArrivals', () => {
  it('keeps each attendee’s first check-in of the day and ignores re-entry', () => {
    const arrivals = firstArrivals([
      event('a2', 'p1', 5),
      event('a1', 'p1', 60),
      event('out', 'p1', 30, { kind: 'out' }),
      event('b1', 'p2', 2),
    ]);
    expect(arrivals.map((a) => a.id).sort()).toEqual(['a1', 'b1']);
  });

  it('drops an undone check-in and the row that undid it', () => {
    const arrivals = firstArrivals([
      event('a1', 'p1', 5),
      event('undo', 'p1', 4, { voids_event_id: 'a1' }),
    ]);
    expect(arrivals).toEqual([]);
  });

  it('counts the same person once per day', () => {
    const arrivals = firstArrivals([event('d1', 'p1', 60 * 24), event('d2', 'p1', 5, { day: 'day2' })]);
    expect(arrivals).toHaveLength(2);
  });
});

describe('small helpers', () => {
  it('uses only a first name', () => {
    expect(firstName('  Priya   Raman ')).toBe('Priya');
    expect(firstName('')).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it('crowns the most-borrowed title', () => {
    expect(topTitle(['Cascadia', 'Azul', 'Cascadia', null])).toEqual({ title: 'Cascadia', count: 2 });
    expect(topTitle([])).toBeNull();
  });

  it('accepts only the exact display key as a bearer token', () => {
    const withKey = (value: string) => new Request('https://api.test/api/display/feed', { headers: { Authorization: value } });
    expect(displayKeyPresented(withKey('Bearer s3cret'), 's3cret')).toBe(true);
    expect(displayKeyPresented(withKey('Bearer s3cre'), 's3cret')).toBe(false);
    expect(displayKeyPresented(withKey('s3cret'), 's3cret')).toBe(false);
    expect(displayKeyPresented(withKey('Bearer '), undefined)).toBe(false);
    expect(displayKeyPresented(withKey('Bearer '), '')).toBe(false);
  });
});

describe('buildDisplayFeed', () => {
  function feedTables(overrides: Record<string, any> = {}) {
    return {
      editions: ok(edition),
      schedule_items: ok([
        {
          id: 's1', day: '2026-09-12', start_time: '13:00:00', end_time: '17:00:00', title: 'Catan Tournament',
          location: 'Sandbox', kind: 'tournament', section: 'programme', is_all_day: false, host_name: null,
          public_status: 'published', display_order: 0, description: 'private detail', capacity: 12,
        },
      ]),
      announcements: ok([
        { id: 'n1', title: 'Lunch', body: 'Food court open', severity: 'info', audience: 'all', starts_at: minutesAgo(30), ends_at: null, updated_at: minutesAgo(30) },
        { id: 'n2', title: 'Sunday only', body: 'x', severity: 'info', audience: 'day2', starts_at: minutesAgo(30), ends_at: null, updated_at: minutesAgo(30) },
      ]),
      check_in_events: ok([
        event('e1', 'p1', 2),
        event('e2', 'p2', 30),
        event('e3', 'p3', 1),
      ]),
      library_loans: ok([
        { checked_out_at: minutesAgo(20), status: 'checked_out', library_copies: { library_titles: { title: 'Cascadia' } } },
        { checked_out_at: minutesAgo(50), status: 'returned', library_copies: { library_titles: { title: 'Cascadia' } } },
        { checked_out_at: minutesAgo(200), status: 'returned', library_copies: { library_titles: { title: 'Azul' } } },
      ]),
      session_signups: ok([{ signed_up_at: minutesAgo(15) }, { signed_up_at: '2026-09-01T10:00:00.000Z' }]),
      attendees: ok([
        { id: 'p1', display_name: 'Priya Raman' },
        { id: 'p3', display_name: null },
      ]),
      ...overrides,
    };
  }

  it('serves the programme, today’s notices and derived stats without names by default', async () => {
    const { sb, from } = client(feedTables());
    const res = await buildDisplayFeed(sb, NOW, false);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(body.day).toBe('day1');
    expect(body.names_enabled).toBe(false);
    expect(body.arrivals).toEqual([]);
    expect(from).not.toHaveBeenCalledWith('attendees');

    expect(body.schedule[0]).not.toHaveProperty('description');
    expect(body.schedule[0]).not.toHaveProperty('capacity');
    expect(body.announcements.map((n: any) => n.id)).toEqual(['n1']);

    expect(body.stats).toEqual({
      checked_in_today: 3,
      checked_in_total: 3,
      arrivals: { last_1h: 3, last_2h: 3, last_3h: 3, today: 3, total: 3 },
      loans: { last_1h: 2, last_2h: 2, last_3h: 2, today: 3, total: 3 },
      games_out_now: 1,
      top_game_today: { title: 'Cascadia', count: 2 },
      bookings: { last_1h: 1, last_2h: 1, last_3h: 1, today: 1, total: 2 },
    });
  });

  it('adds first names for fresh arrivals only when the key was presented', async () => {
    const { sb, queries } = client(feedTables());
    const body: any = await (await buildDisplayFeed(sb, NOW, true)).json();

    // p2 arrived 30 minutes ago (outside the window); p3 has no name.
    expect(queries.attendees.in).toHaveBeenCalledWith('id', ['p3', 'p1']);
    expect(body.arrivals).toEqual([{ id: 'e1', name: 'Priya', at: minutesAgo(2) }]);
  });

  it('keeps serving the programme when the name lookup fails', async () => {
    const { sb } = client(feedTables({ attendees: { data: null, error: { message: 'boom' } } }));
    const res = await buildDisplayFeed(sb, NOW, true);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).arrivals).toEqual([]);
  });

  it('returns an empty state when no edition is current', async () => {
    const { sb } = client({ editions: ok(null) });
    const body: any = await (await buildDisplayFeed(sb, NOW, false)).json();
    expect(body.edition).toBeNull();
    expect(body.stats).toBeNull();
  });

  it('fails loudly rather than serving a half-empty screen', async () => {
    const { sb } = client(feedTables({ library_loans: { data: null, error: { message: 'down' } } }));
    const res = await buildDisplayFeed(sb, NOW, false);
    expect(res.status).toBe(503);
  });
});

describe('handleDisplayFeed', () => {
  it('rate-limits per IP', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env: any = { PUBLIC_RATE_LIMITER: { limit } };
    const req = new Request('https://api.test/api/display/feed', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
    const res = await handleDisplayFeed(req, env, NOW);
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'display-feed:ip:1.2.3.4' });
  });
});
