import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../editions', () => ({ getCurrentEdition: vi.fn() }));

import {
  handleSessionRoster,
  handleSessionSignupCreate,
  handleSessionSignupRemove,
} from './session-roster';

const ORIGIN = 'https://admin.replaycon.in';
const STAFF = 'staff@replaycon.in';
const SESSION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const A1 = 'a1111111-1111-1111-1111-111111111111';
const A2 = 'a2222222-2222-2222-2222-222222222222';
const A3 = 'a3333333-3333-3333-3333-333333333333';

function rosterClient(options: {
  session?: Record<string, unknown> | null;
  signups?: Array<Record<string, unknown>>;
  attendees?: Array<Record<string, unknown>>;
} = {}) {
  const {
    session = { id: SESSION, title: 'Werewolf', capacity: 2, signup_mode: 'app', day: '2026-09-12', start_time: '14:00' },
    signups = [],
    attendees = [],
  } = options;
  return {
    from: (table: string) => {
      if (table === 'schedule_items') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: session, error: null }) }) }),
      };
      if (table === 'session_signups') return {
        select: () => ({ eq: () => ({ neq: () => ({ order: async () => ({ data: signups, error: null }) }) }) }),
      };
      if (table === 'attendees') return {
        select: () => ({ in: async () => ({ data: attendees, error: null }) }),
      };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function rpcClient(rpcResult: { data?: unknown; error?: { message: string } | null }, onAudit?: (r: unknown) => void) {
  return {
    rpc: async () => ({ data: rpcResult.data ?? null, error: rpcResult.error ?? null }),
    from: (table: string) => {
      if (table === 'admin_audit_log') return { insert: async (row: unknown) => { onAudit?.(row); return { error: null }; } };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const body = (attendeeId: string) =>
  new Request('https://x', { method: 'POST', body: JSON.stringify({ attendee_id: attendeeId }) });

beforeEach(() => vi.clearAllMocks());

describe('handleSessionRoster', () => {
  it('separates the confirmed from the queue, keeping queue order', async () => {
    const res = await handleSessionRoster(new Request('https://x'), rosterClient({
      signups: [
        { attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: null },
        { attendee_id: A2, status: 'waitlisted', signed_up_at: '2026-09-12T09:05:00Z', promoted_at: null },
        { attendee_id: A3, status: 'waitlisted', signed_up_at: '2026-09-12T09:10:00Z', promoted_at: null },
      ],
      attendees: [
        { id: A1, seat_index: 1, display_name: 'Priya', phone: '9876543210' },
        { id: A2, seat_index: 1, display_name: 'Arjun', phone: null },
        { id: A3, seat_index: 2, display_name: null, phone: null },
      ],
    }), SESSION, ORIGIN);
    const data = await res.json() as any;

    expect(res.status).toBe(200);
    expect(data.confirmed.map((c: any) => c.name)).toEqual(['Priya']);
    expect(data.waitlisted.map((w: any) => w.name)).toEqual(['Arjun', 'Guest 2']);
  });

  it('reports remaining seats against capacity', async () => {
    const res = await handleSessionRoster(new Request('https://x'), rosterClient({
      signups: [{ attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: null }],
      attendees: [{ id: A1, seat_index: 1, display_name: 'Priya', phone: null }],
    }), SESSION, ORIGIN);

    expect((await res.json() as any).session).toMatchObject({ capacity: 2, seats_remaining: 1 });
  });

  it('never prints a whole phone number', async () => {
    const res = await handleSessionRoster(new Request('https://x'), rosterClient({
      signups: [{ attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: null }],
      attendees: [{ id: A1, seat_index: 1, display_name: 'Priya', phone: '9876543210' }],
    }), SESSION, ORIGIN);
    const text = await res.text();

    expect(text).not.toContain('9876543210');
    expect(text).toContain('••••3210');
  });

  it('flags someone who reached their seat by promotion', async () => {
    const res = await handleSessionRoster(new Request('https://x'), rosterClient({
      signups: [{ attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: '2026-09-12T10:00:00Z' }],
      attendees: [{ id: A1, seat_index: 1, display_name: 'Priya', phone: null }],
    }), SESSION, ORIGIN);

    expect((await res.json() as any).confirmed[0].promoted).toBe(true);
  });

  it('copes with an empty session', async () => {
    const res = await handleSessionRoster(new Request('https://x'), rosterClient(), SESSION, ORIGIN);
    const data = await res.json() as any;
    expect(data.confirmed).toEqual([]);
    expect(data.waitlisted).toEqual([]);
  });

  it('reports an unknown session', async () => {
    const res = await handleSessionRoster(new Request('https://x'), rosterClient({ session: null }), SESSION, ORIGIN);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed session id', async () => {
    expect((await handleSessionRoster(new Request('https://x'), rosterClient(), 'nope', ORIGIN)).status).toBe(400);
  });
});

describe('handleSessionSignupCreate', () => {
  it('books through the same locking function the app uses', async () => {
    let audit: any;
    const res = await handleSessionSignupCreate(
      body(A1), rpcClient({ data: [{ status: 'confirmed', queue_position: 0 }] }, (r) => { audit = r; }),
      SESSION, STAFF, ORIGIN,
    );

    expect(await res.json()).toEqual({ status: 'confirmed', queue_position: 0 });
    // Same rules as the app; the audit records only that staff did it.
    expect(audit.action).toBe('session_signup.desk');
    expect(audit.actor_email).toBe(STAFF);
  });

  it('waitlists from the desk when the session is full', async () => {
    const res = await handleSessionSignupCreate(
      body(A1), rpcClient({ data: [{ status: 'waitlisted', queue_position: 2 }] }), SESSION, STAFF, ORIGIN,
    );
    expect(await res.json()).toEqual({ status: 'waitlisted', queue_position: 2 });
  });

  it('refuses a session nobody opted in for booking', async () => {
    const res = await handleSessionSignupCreate(
      body(A1), rpcClient({ error: { message: 'error: session_not_bookable' } }), SESSION, STAFF, ORIGIN,
    );
    expect(res.status).toBe(409);
  });

  it('rejects a malformed attendee id', async () => {
    const res = await handleSessionSignupCreate(
      body('nope'), rpcClient({ data: [] }), SESSION, STAFF, ORIGIN,
    );
    expect(res.status).toBe(400);
  });
});

describe('handleSessionSignupRemove', () => {
  it('tells staff who was promoted, since nothing else will', async () => {
    const res = await handleSessionSignupRemove(
      body(A1), rpcClient({ data: [{ cancelled: true, promoted_attendee_id: A2 }] }), SESSION, STAFF, ORIGIN,
    );
    // There is no push notification yet, so a human has to pass this on.
    expect(await res.json()).toEqual({ removed: true, promoted_attendee_id: A2 });
  });

  it('reports nothing removed without pretending otherwise', async () => {
    const res = await handleSessionSignupRemove(
      body(A1), rpcClient({ data: [{ cancelled: false, promoted_attendee_id: null }] }), SESSION, STAFF, ORIGIN,
    );
    expect(await res.json()).toMatchObject({ removed: false });
  });
});
