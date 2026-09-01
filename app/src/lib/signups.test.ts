import { describe, it, expect, vi, afterEach } from 'vitest';
import { bySession, cancelSignup, fetchSignups, seatsLabel, signUp, type Signup } from './signups';
import type { Device } from './device';

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
    expect(await fetchSignups(DEVICE)).toHaveLength(1);
  });

  it('returns null rather than an empty list when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    // Null means "keep what you had". An empty array would wipe someone's
    // bookings off the screen the moment the venue wifi dipped.
    expect(await fetchSignups(DEVICE)).toBeNull();
  });

  it('copes with a malformed payload', async () => {
    vi.stubGlobal('fetch', respond(200, { signups: 'nope' }));
    expect(await fetchSignups(DEVICE)).toEqual([]);
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
