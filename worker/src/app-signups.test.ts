import { describe, it, expect, vi, beforeEach } from 'vitest';

const sbMock = { from: vi.fn(), rpc: vi.fn() };
vi.mock('./supabase', () => ({ serviceClient: () => sbMock }));
vi.mock('./editions', () => ({ getCurrentEdition: vi.fn() }));
vi.mock('./attendee-auth', () => ({ authenticateDevice: vi.fn() }));

import { handleMySignups, handleSignUp, handleCancelSignup } from './app-signups';
import { getCurrentEdition } from './editions';
import { authenticateDevice } from './attendee-auth';

const EDITION = { id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' };
const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const env = {} as never;
const ctx = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never;

const auth = authenticateDevice as unknown as ReturnType<typeof vi.fn>;
const currentEdition = getCurrentEdition as unknown as ReturnType<typeof vi.fn>;

const ARRIVED = [{ id: 'e1', day: 'day1', kind: 'in', voids_event_id: null, occurred_at: '2026-09-12T04:00:00Z' }];

function tables(options: { events?: unknown[]; signups?: unknown[]; onSelect?: (t: string) => void } = {}) {
  sbMock.from.mockImplementation((table: string) => {
    options.onSelect?.(table);
    if (table === 'attendees') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { registration_id: 'reg-1' }, error: null }) }) }),
    };
    if (table === 'registrations') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { days: ['day1', 'day2'] }, error: null }) }) }),
    };
    if (table === 'check_in_events') return {
      select: () => ({ eq: async () => ({ data: options.events ?? ARRIVED, error: null }) }),
    };
    if (table === 'session_signups') return {
      select: () => ({ eq: () => ({ neq: async () => ({ data: options.signups ?? [], error: null }) }) }),
    };
    if (table === 'schedule_items') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: 'Werewolf' }, error: null }) }) }),
    };
    throw new Error(`unexpected table ${table}`);
  });
}

function signedIn() {
  auth.mockResolvedValue({ ok: true, identity: { attendee_id: ATTENDEE, edition_id: EDITION.id, device_id: 'd1' } });
}

function post(body: unknown) {
  return new Request('https://api/api/app/signups', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-09-12T06:30:00Z'));
  currentEdition.mockResolvedValue(EDITION);
});

describe('authorisation', () => {
  it.each([
    ['missing_token', 401],
    ['invalid_token', 401],
    ['expired_token', 401],
    ['revoked_token', 401],
  ])('rejects a %s with %i', async (error, status) => {
    auth.mockResolvedValue({ ok: false, error });
    const res = await handleSignUp(post({ schedule_item_id: SESSION }), env);
    expect(res.status).toBe(status);
  });

  it('does not tell the app to log out when the database is the problem', async () => {
    auth.mockResolvedValue({ ok: false, error: 'query_failed' });
    const res = await handleSignUp(post({ schedule_item_id: SESSION }), env);
    // A 401 would make the app clear a perfectly good token and restart setup.
    expect(res.status).toBe(503);
  });
});

describe('handleMySignups', () => {
  it('returns only this attendee’s live sign-ups', async () => {
    signedIn();
    let filtered: string | null = null;
    sbMock.from.mockImplementation((table: string) => {
      if (table !== 'session_signups') throw new Error(`unexpected ${table}`);
      return {
        select: () => ({
          eq: (_col: string, value: string) => {
            filtered = value;
            return { neq: async () => ({ data: [{ schedule_item_id: SESSION, status: 'confirmed' }], error: null }) };
          },
        }),
      };
    });

    const res = await handleMySignups(new Request('https://api/api/app/me/signups'), env);

    expect(res.status).toBe(200);
    // Scoped to the token's own attendee: there is no way to read anyone else's.
    expect(filtered).toBe(ATTENDEE);
    expect(await res.json()).toMatchObject({ signups: [{ status: 'confirmed' }] });
  });
});

describe('handleSignUp', () => {
  it('books a seat through the locking function, not a plain insert', async () => {
    signedIn();
    tables();
    sbMock.rpc.mockResolvedValue({ data: [{ status: 'confirmed', queue_position: 0 }], error: null });

    const res = await handleSignUp(post({ schedule_item_id: SESSION }), env);

    expect(sbMock.rpc).toHaveBeenCalledWith('sign_up_for_session', {
      p_attendee_id: ATTENDEE, p_schedule_item_id: SESSION,
    });
    expect(await res.json()).toEqual({ status: 'confirmed', queue_position: 0 });
  });

  it('reports a waitlist place', async () => {
    signedIn();
    tables();
    sbMock.rpc.mockResolvedValue({ data: [{ status: 'waitlisted', queue_position: 3 }], error: null });

    expect(await (await handleSignUp(post({ schedule_item_id: SESSION }), env)).json())
      .toEqual({ status: 'waitlisted', queue_position: 3 });
  });

  it('refuses someone who has not checked in', async () => {
    signedIn();
    tables({ events: [] });

    const res = await handleSignUp(post({ schedule_item_id: SESSION }), env);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_checked_in' });
    // The gate is checked before the booking is attempted at all.
    expect(sbMock.rpc).not.toHaveBeenCalled();
  });

  it('still allows someone who arrived and stepped out', async () => {
    signedIn();
    tables({ events: [...ARRIVED, { id: 'e2', day: 'day1', kind: 'out', voids_event_id: null, occurred_at: '2026-09-12T05:00:00Z' }] });
    sbMock.rpc.mockResolvedValue({ data: [{ status: 'confirmed', queue_position: 0 }], error: null });

    expect((await handleSignUp(post({ schedule_item_id: SESSION }), env)).status).toBe(200);
  });

  it.each([
    ['session_not_bookable', 409],
    ['session_not_published', 409],
    ['session_not_found', 404],
    ['wrong_edition', 409],
  ])('maps a %s exception onto %i', async (message, status) => {
    signedIn();
    tables();
    sbMock.rpc.mockResolvedValue({ data: null, error: { message: `error: ${message}` } });

    const res = await handleSignUp(post({ schedule_item_id: SESSION }), env);
    expect(res.status).toBe(status);
  });

  it('rejects a malformed session id before doing anything', async () => {
    signedIn();
    const res = await handleSignUp(post({ schedule_item_id: 'nope' }), env);
    expect(res.status).toBe(400);
    expect(sbMock.rpc).not.toHaveBeenCalled();
  });
});

describe('handleCancelSignup', () => {
  it('cancels through the promoting function', async () => {
    signedIn();
    tables();
    sbMock.rpc.mockResolvedValue({ data: [{ cancelled: true, promoted_attendee_id: 'someone-else' }], error: null });

    const res = await handleCancelSignup(new Request('https://api/x', { method: 'DELETE' }), env, ctx, SESSION);

    expect(sbMock.rpc).toHaveBeenCalledWith('cancel_session_signup', {
      p_attendee_id: ATTENDEE, p_schedule_item_id: SESSION,
    });
    // Who got promoted is somebody else's business, so it is not echoed back.
    expect(await res.json()).toEqual({ cancelled: true });
  });

  it('is not gated on checking in, so a seat can always be released', async () => {
    signedIn();
    sbMock.from.mockImplementation(() => { throw new Error('should not consult check-ins'); });
    sbMock.rpc.mockResolvedValue({ data: [{ cancelled: true, promoted_attendee_id: null }], error: null });

    // Refusing this would keep the seat out of circulation for whoever waits.
    expect((await handleCancelSignup(new Request('https://api/x', { method: 'DELETE' }), env, ctx, SESSION)).status).toBe(200);
  });

  it('reports nothing to cancel without pretending it worked', async () => {
    signedIn();
    tables();
    sbMock.rpc.mockResolvedValue({ data: [{ cancelled: false, promoted_attendee_id: null }], error: null });
    expect(await (await handleCancelSignup(new Request('https://api/x', { method: 'DELETE' }), env, ctx, SESSION)).json())
      .toEqual({ cancelled: false });
  });

  it('rejects a malformed session id', async () => {
    signedIn();
    const res = await handleCancelSignup(new Request('https://api/x', { method: 'DELETE' }), env, ctx, 'nope');
    expect(res.status).toBe(400);
  });
});
