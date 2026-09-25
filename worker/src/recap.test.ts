import { describe, expect, it, vi } from 'vitest';
import { buildRecap, handleRecap, shapeRecap } from './recap';

const REPLAY_3 = {
  id: 'ed-3',
  slug: 'replay-3',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  is_published: true,
};

const RAW = {
  attendance: { people: 285, by_day: { day1: 154, day2: 185 }, both_days: 54 },
  tickets: { across_days: 446, by_day: { day1: 200, day2: 246 } },
  sessions: {
    seats_booked: 286,
    sessions_booked: 38,
    by_item: [{ schedule_item_id: 'si-quiz', booked: 30 }],
  },
  library: {
    loans: 145,
    most_borrowed: [
      { title: 'Hot Streak', loans: 7 },
      { title: 'Skull', loans: 6 },
    ],
  },
};

/** `from('editions')…maybeSingle()` resolves to `edition`; `rpc` to `recap`. */
function client(edition: any, recap: any = { data: RAW, error: null }) {
  const chain: any = {};
  for (const method of ['select', 'eq']) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => edition);
  const rpc = vi.fn(async () => recap);
  return { sb: { from: vi.fn(() => chain), rpc } as any, rpc };
}

// 04:30 in Bengaluru on 14 September: the first morning after REPLAY 3.
const MORNING_AFTER = new Date('2026-09-13T23:00:00Z');
// 23:00 in Bengaluru on 13 September: the last evening of REPLAY 3.
const LAST_EVENING = new Date('2026-09-13T17:30:00Z');

describe('buildRecap', () => {
  it('publishes a finished, published edition', async () => {
    const { sb, rpc } = client({ data: REPLAY_3, error: null });
    const res = await buildRecap(sb, 'replay-3', MORNING_AFTER);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(rpc).toHaveBeenCalledWith('edition_recap', { p_edition_id: 'ed-3' });
    const body = await res.json();
    expect(body.edition).toEqual({ slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13' });
    expect(body.attendance.people).toBe(285);
  });

  it('has nothing to say while the edition is still on, in Bengaluru time', async () => {
    const { sb, rpc } = client({ data: REPLAY_3, error: null });
    const res = await buildRecap(sb, 'replay-3', LAST_EVENING);
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('has nothing to say about an unpublished edition', async () => {
    const { sb, rpc } = client({ data: { ...REPLAY_3, is_published: false }, error: null });
    expect((await buildRecap(sb, 'replay-3', MORNING_AFTER)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('has nothing to say about an edition that does not exist', async () => {
    const { sb } = client({ data: null, error: null });
    expect((await buildRecap(sb, 'replay-9', MORNING_AFTER)).status).toBe(404);
  });

  it('refuses a slug that could not be one, without asking the database', async () => {
    const { sb } = client({ data: REPLAY_3, error: null });
    expect((await buildRecap(sb, 'replay 3; drop', MORNING_AFTER)).status).toBe(404);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('reports a failed count as unavailable, without echoing the database error', async () => {
    const { sb } = client({ data: REPLAY_3, error: null }, { data: null, error: { message: 'relation "secret" does not exist' } });
    const res = await buildRecap(sb, 'replay-3', MORNING_AFTER);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret');
  });

  it('publishes exactly the contract, and nothing the function grows later', async () => {
    const { sb } = client(
      { data: REPLAY_3, error: null },
      { data: { ...RAW, attendance: { ...RAW.attendance, attendee_ids: ['a-1'] }, owners: ['Priya'] }, error: null },
    );
    const body = await (await buildRecap(sb, 'replay-3', MORNING_AFTER)).json();
    expect(Object.keys(body).sort()).toEqual(['attendance', 'edition', 'library', 'sessions', 'tickets']);
    expect(Object.keys(body.tickets).sort()).toEqual(['across_days', 'by_day']);
    expect(Object.keys(body.attendance).sort()).toEqual(['both_days', 'by_day', 'people']);
    expect(Object.keys(body.sessions).sort()).toEqual(['by_item', 'seats_booked', 'sessions_booked']);
    expect(Object.keys(body.library).sort()).toEqual(['loans', 'most_borrowed']);
    expect(JSON.stringify(body)).not.toContain('Priya');
    expect(JSON.stringify(body)).not.toContain('a-1');
  });
});

describe('shapeRecap', () => {
  it('passes REPLAY 3 through unchanged', () => {
    expect(shapeRecap(RAW)).toEqual(RAW);
  });

  it('turns anything that is not a count into zero', () => {
    const shaped = shapeRecap({ attendance: { people: '285', both_days: -3, by_day: { day1: null } } });
    expect(shaped.attendance).toEqual({ people: 285, both_days: 0, by_day: { day1: 0 } });
    expect(shaped.tickets).toEqual({ across_days: 0, by_day: {} });
    expect(shaped.sessions).toEqual({ seats_booked: 0, sessions_booked: 0, by_item: [] });
    expect(shaped.library).toEqual({ loans: 0, most_borrowed: [] });
  });

  it('keeps only the two event days', () => {
    expect(shapeRecap({ attendance: { by_day: { day1: 1, day3: 9, __proto__x: 4 } } }).attendance.by_day).toEqual({ day1: 1 });
  });

  it('never lists more than five games, and drops untitled ones', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `Game ${i}`, loans: 8 - i }));
    const shaped = shapeRecap({ library: { most_borrowed: [{ title: '  ', loans: 9 }, ...many] } });
    expect(shaped.library.most_borrowed.map((g) => g.title)).toEqual(['Game 0', 'Game 1', 'Game 2', 'Game 3', 'Game 4']);
  });

  it('survives the database returning nothing at all', () => {
    expect(shapeRecap(null).attendance.people).toBe(0);
  });
});

describe('handleRecap', () => {
  it('stops a caller over the per-IP limit before touching the database', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env: any = { PUBLIC_RATE_LIMITER: { limit } };
    const req = new Request('https://api.replaycon.in/api/recap/replay-3', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
    const res = await handleRecap(req, env, 'replay-3', MORNING_AFTER);
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'recap:ip:203.0.113.7' });
  });
});
