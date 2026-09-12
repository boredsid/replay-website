import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  bookingBlock, bySession, cancelSignup, fetchSignups, overlaps, seatsLabel, signUp,
  type Signup,
} from './signups';
import type { Device } from './device';
import type { ScheduleItem } from '../types';

const DEVICE: Device = {
  token: 'tok', qr_token: 'QR', display_name: 'Priya',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};
const SESSION = 'session-1';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe('signUp', () => {
  it('reports a confirmed seat', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'confirmed', queue_position: 0 }));
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: true, status: 'confirmed', queue_position: 0 });
  });

  it('reports a place in the queue', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'waitlisted', queue_position: 3 }));
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: true, status: 'waitlisted', queue_position: 3 });
  });

  it('sends the device token', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ status: 'confirmed', queue_position: 0 }), { status: 200 });
    }));

    await signUp(DEVICE, SESSION);

    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('distinguishes not being checked in from a general failure', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'not_checked_in' }));
    // The app tells them to check in at the desk, rather than "try again".
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: false, error: 'not_checked_in' });
  });

  it('flags a dead token so the app can restart setup', async () => {
    vi.stubGlobal('fetch', respond(401, { error: 'invalid_token' }));
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: false, error: 'unauthorised' });
  });

  it('does not treat a sick server as a dead token', async () => {
    vi.stubGlobal('fetch', respond(503, { error: 'event_unavailable' }));
    // Clearing a perfectly good pairing because a query hiccuped would be worse
    // than the outage itself.
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: false, error: 'failed' });
  });

  it('separates being offline from being refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: false, error: 'offline' });
  });

  it('survives an error body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));
    expect(await signUp(DEVICE, SESSION)).toEqual({ ok: false, error: 'failed' });
  });
});

describe('cancelSignup', () => {
  it('reports success', async () => {
    vi.stubGlobal('fetch', respond(200, { cancelled: true }));
    expect(await cancelSignup(DEVICE, SESSION)).toEqual({ ok: true });
  });

  it('reports being offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await cancelSignup(DEVICE, SESSION)).toEqual({ ok: false, error: 'offline' });
  });
});

describe('fetchSignups', () => {
  it('returns the list', async () => {
    vi.stubGlobal('fetch', respond(200, { signups: [{ schedule_item_id: SESSION, status: 'confirmed' }] }));
    expect((await fetchSignups(DEVICE))?.signups).toHaveLength(1);
  });

  it('carries the days the desk has let them into', async () => {
    vi.stubGlobal('fetch', respond(200, { signups: [], bookable_dates: ['2026-09-12'] }));
    expect((await fetchSignups(DEVICE))?.bookableDates).toEqual(['2026-09-12']);
  });

  it('treats a missing answer as unknown, not as “no days”', async () => {
    vi.stubGlobal('fetch', respond(200, { signups: [], bookable_dates: null }));
    // Null lets the app offer everything and let the server explain a refusal.
    // An empty array would grey out the whole programme on a server hiccup.
    expect((await fetchSignups(DEVICE))?.bookableDates).toBeNull();
  });

  it('returns null rather than an empty list when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    // Null means "keep what you had". An empty array would wipe someone's
    // bookings off the screen the moment the venue wifi dipped.
    expect(await fetchSignups(DEVICE)).toBeNull();
  });

  it('copes with a malformed payload', async () => {
    vi.stubGlobal('fetch', respond(200, { signups: 'nope' }));
    expect((await fetchSignups(DEVICE))?.signups).toEqual([]);
  });
});

describe('bySession', () => {
  it('indexes bookings for lookup by a card', () => {
    const signups = [
      { schedule_item_id: 'a', status: 'confirmed', signed_up_at: '', promoted_at: null },
      { schedule_item_id: 'b', status: 'waitlisted', signed_up_at: '', promoted_at: null },
    ] as Signup[];
    expect(bySession(signups).get('b')?.status).toBe('waitlisted');
  });
});

describe('seatsLabel', () => {
  it('says nothing when there is no limit', () => {
    expect(seatsLabel(null)).toBeNull();
  });

  it('says nothing when there is plenty of room', () => {
    // "18 left" is noise; it does not change what anybody does.
    expect(seatsLabel(18)).toBeNull();
  });

  it('warns when a session is nearly full', () => {
    expect(seatsLabel(2)).toBe('2 left');
    expect(seatsLabel(5)).toBe('5 left');
  });

  it('says full rather than "0 left"', () => {
    expect(seatsLabel(0)).toBe('Full');
  });
});

function session(id: string, over: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    day: '2026-09-12',
    start_time: '14:00',
    end_time: '16:00',
    title: id,
    description: null,
    location: null,
    kind: 'workshop',
    section: 'programme',
    is_all_day: false,
    host_name: null,
    signup_mode: 'app',
    public_status: 'published',
    display_order: 0,
    capacity: null,
    seats_remaining: null,
    ...over,
  };
}

const HELD: Signup = {
  schedule_item_id: 'held', status: 'confirmed', signed_up_at: '', promoted_at: null, queue_position: 0,
};

describe('overlaps', () => {
  it('catches a genuine overlap', () => {
    expect(overlaps(session('a'), session('b', { start_time: '15:00', end_time: '17:00' }))).toBe(true);
  });

  it('lets back-to-back sessions stand', () => {
    // 14:00–16:00 then 16:00–18:00 is a schedule, not a clash.
    expect(overlaps(session('a'), session('b', { start_time: '16:00', end_time: '18:00' }))).toBe(false);
  });

  it('never clashes across days', () => {
    expect(overlaps(session('a'), session('b', { day: '2026-09-13' }))).toBe(false);
  });

  it('never clashes with an all-day item', () => {
    // One open-play sign-up must not swallow the entire programme.
    const allDay = session('b', { is_all_day: true, start_time: null, end_time: null });
    expect(overlaps(session('a'), allDay)).toBe(false);
    expect(overlaps(allDay, session('a'))).toBe(false);
  });
});

describe('bookingBlock', () => {
  const held = session('held');
  const clashing = session('clashing', { title: 'Catan', start_time: '15:00', end_time: '17:00' });
  const later = session('later', { start_time: '16:00', end_time: '18:00' });
  const schedule = [held, clashing, later];
  const mine = bySession([HELD]);

  it('blocks a session overlapping one they hold, and names it', () => {
    const block = bookingBlock(clashing, mine, schedule, ['2026-09-12']);
    expect(block?.reason).toBe('clash');
    expect(block?.detail).toContain('held');
  });

  it('lets a session they already hold through, so it can be given up', () => {
    expect(bookingBlock(held, mine, schedule, ['2026-09-12'])).toBeNull();
  });

  it('allows a session that merely follows one they hold', () => {
    expect(bookingBlock(later, mine, schedule, ['2026-09-12'])).toBeNull();
  });

  it('blocks a day the desk has not checked them in for', () => {
    const sunday = session('sunday', { day: '2026-09-13' });
    expect(bookingBlock(sunday, mine, [...schedule, sunday], ['2026-09-12'])?.reason).toBe('wrong-day');
  });

  it('blocks nothing on the day question when the server did not answer', () => {
    const sunday = session('sunday', { day: '2026-09-13' });
    // The server refuses independently; the app must not invent a restriction.
    expect(bookingBlock(sunday, mine, [...schedule, sunday], null)).toBeNull();
  });

  it('counts a queued place as held', () => {
    // Promotion is immediate, so a waitlist can become a seat at any moment.
    const queued = bySession([{ ...HELD, status: 'waitlisted' }]);
    expect(bookingBlock(clashing, queued, schedule, ['2026-09-12'])?.reason).toBe('clash');
  });
});
