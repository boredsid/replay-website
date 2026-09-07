import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../editions', () => ({ getCurrentEdition: vi.fn(), getEditionById: vi.fn() }));

import { getCurrentEdition, getEditionById } from '../editions';
import { handleEventsOverview, handleEventsSignupCreate, handleEventsSignupRemove } from './events';

const ORIGIN = 'https://admin.replaycon.in';
const STAFF = 'staff@replaycon.in';
const EDITION = { id: 'ed-1', slug: 'replay-3', name: 'REPLAY' };
const S1 = 'b1111111-1111-1111-1111-111111111111';
const S2 = 'b2222222-2222-2222-2222-222222222222';
const A1 = 'a1111111-1111-1111-1111-111111111111';
const A2 = 'a2222222-2222-2222-2222-222222222222';
const A3 = 'a3333333-3333-3333-3333-333333333333';

const ENV = {} as never;
const CTX = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never;

function session(over: Record<string, unknown> = {}) {
  return {
    id: S1, title: 'Werewolf', day: '2026-09-12', start_time: '14:00', end_time: '16:00',
    is_all_day: false, location: 'Table 3', host_name: 'Priya', kind: 'social-game',
    section: 'programme', capacity: 2, signup_mode: 'app', public_status: 'published',
    display_order: 0, ...over,
  };
}

/**
 * The overview makes three reads and nothing else; the mock refuses anything
 * else so a fourth query added later shows up as a failing test rather than a
 * slower page.
 */
function overviewClient(options: {
  sessions?: Array<Record<string, unknown>>;
  signups?: Array<Record<string, unknown>>;
  attendees?: Array<Record<string, unknown>>;
  signupError?: { message: string };
} = {}) {
  const { sessions = [session()], signups = [], attendees = [], signupError } = options;
  return {
    from: (table: string) => {
      if (table === 'schedule_items') {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.order = () => chain;
        // The last `.order()` is awaited directly, so the chain resolves too.
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: sessions, error: null });
        return { select: () => chain };
      }
      if (table === 'session_signups') {
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.neq = () => chain;
        chain.order = () => chain;
        chain.limit = async () => ({ data: signups, error: signupError ?? null });
        return { select: () => chain };
      }
      if (table === 'attendees') return { select: () => ({ in: async () => ({ data: attendees, error: null }) }) };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function rpcClient(rpcResult: { data?: unknown; error?: { message: string } | null }, onAudit?: (r: unknown) => void) {
  return {
    rpc: async () => ({ data: rpcResult.data ?? null, error: rpcResult.error ?? null }),
    from: (table: string) => {
      if (table === 'admin_audit_log') return { insert: async (row: unknown) => { onAudit?.(row); return { error: null }; } };
      if (table === 'schedule_items') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: 'Werewolf' }, error: null }) }) }),
      };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const post = (body: unknown) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentEdition).mockResolvedValue(EDITION as never);
});

describe('handleEventsOverview', () => {
  it('returns every bookable session with its list and its queue', async () => {
    const res = await handleEventsOverview(new Request('https://x'), ENV, overviewClient({
      sessions: [session(), session({ id: S2, title: 'Quiz', capacity: 1 })],
      signups: [
        { schedule_item_id: S1, attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: null },
        { schedule_item_id: S1, attendee_id: A2, status: 'confirmed', signed_up_at: '2026-09-12T09:05:00Z', promoted_at: '2026-09-12T10:00:00Z' },
        { schedule_item_id: S1, attendee_id: A3, status: 'waitlisted', signed_up_at: '2026-09-12T09:10:00Z', promoted_at: null },
        { schedule_item_id: S2, attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:20:00Z', promoted_at: null },
      ],
      attendees: [
        { id: A1, seat_index: 1, display_name: 'Priya', phone: '9876543210' },
        { id: A2, seat_index: 1, display_name: 'Arjun', phone: null },
        { id: A3, seat_index: 2, display_name: null, phone: null },
      ],
    }), ORIGIN);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.edition).toEqual(EDITION);
    expect(body.sessions).toHaveLength(2);

    const [werewolf, quiz] = body.sessions;
    expect(werewolf.confirmed.map((p: any) => p.name)).toEqual(['Priya', 'Arjun']);
    expect(werewolf.waitlisted).toHaveLength(1);
    expect(werewolf.seats_remaining).toBe(0);
    expect(quiz.confirmed).toHaveLength(1);
    expect(quiz.waitlisted).toEqual([]);
    expect(quiz.seats_remaining).toBe(0);
  });

  it('keeps queue order, so position can be read off the array', async () => {
    // Position is derived from signed_up_at and never stored. The roster reads
    // it the same way; two readings that disagree is the bug this guards.
    const res = await handleEventsOverview(new Request('https://x'), ENV, overviewClient({
      signups: [
        { schedule_item_id: S1, attendee_id: A2, status: 'waitlisted', signed_up_at: '2026-09-12T09:05:00Z', promoted_at: null },
        { schedule_item_id: S1, attendee_id: A3, status: 'waitlisted', signed_up_at: '2026-09-12T09:10:00Z', promoted_at: null },
      ],
      attendees: [
        { id: A2, seat_index: 1, display_name: 'Arjun', phone: null },
        { id: A3, seat_index: 1, display_name: 'Meera', phone: null },
      ],
    }), ORIGIN);
    const body = await res.json() as any;
    expect(body.sessions[0].waitlisted.map((p: any) => p.name)).toEqual(['Arjun', 'Meera']);
  });

  it('masks phone numbers, as every list of people does', async () => {
    const res = await handleEventsOverview(new Request('https://x'), ENV, overviewClient({
      signups: [{ schedule_item_id: S1, attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: null }],
      attendees: [{ id: A1, seat_index: 1, display_name: 'Priya', phone: '9876543210' }],
    }), ORIGIN);
    const body = await res.json() as any;
    const person = body.sessions[0].confirmed[0];
    expect(person.phone_masked).not.toContain('9876543');
    expect(JSON.stringify(body)).not.toContain('9876543210');
  });

  it('reports seats left against capacity, never below zero', async () => {
    const res = await handleEventsOverview(new Request('https://x'), ENV, overviewClient({
      sessions: [session({ capacity: 4 })],
      signups: [{ schedule_item_id: S1, attendee_id: A1, status: 'confirmed', signed_up_at: '2026-09-12T09:00:00Z', promoted_at: null }],
      attendees: [{ id: A1, seat_index: 1, display_name: 'Priya', phone: null }],
    }), ORIGIN);
    const body = await res.json() as any;
    expect(body.sessions[0].seats_remaining).toBe(3);
  });

  it('handles an edition with nothing booked yet', async () => {
    const res = await handleEventsOverview(new Request('https://x'), ENV, overviewClient({ signups: [] }), ORIGIN);
    const body = await res.json() as any;
    expect(body.sessions[0].confirmed).toEqual([]);
    expect(body.sessions[0].seats_remaining).toBe(2);
  });

  it('takes an explicit edition when asked for one', async () => {
    vi.mocked(getEditionById).mockResolvedValue({ ...EDITION, id: 'ed-2' } as never);
    const res = await handleEventsOverview(
      new Request('https://x/api/admin/events?edition_id=ed-2'), ENV, overviewClient(), ORIGIN,
    );
    expect(getEditionById).toHaveBeenCalledWith(ENV, 'ed-2');
    expect(getCurrentEdition).not.toHaveBeenCalled();
    expect((await res.json() as any).edition.id).toBe('ed-2');
  });

  it('says so when there is no current edition rather than returning nothing', async () => {
    vi.mocked(getCurrentEdition).mockResolvedValue(null as never);
    const res = await handleEventsOverview(new Request('https://x'), ENV, overviewClient(), ORIGIN);
    expect(res.status).toBe(503);
    expect((await res.json() as any).error).toBe('no_current_edition');
  });

  it('404s an edition id that is not there', async () => {
    vi.mocked(getEditionById).mockResolvedValue(null as never);
    const res = await handleEventsOverview(
      new Request('https://x/api/admin/events?edition_id=nope'), ENV, overviewClient(), ORIGIN,
    );
    expect(res.status).toBe(404);
    expect((await res.json() as any).error).toBe('edition_not_found');
  });
});

describe('booking from the events board', () => {
  it('books somebody in and records where it came from', async () => {
    let audit: any = null;
    const res = await handleEventsSignupCreate(
      post({ schedule_item_id: S1, attendee_id: A1 }),
      rpcClient({ data: [{ status: 'confirmed', queue_position: 0 }] }, (row) => { audit = row; }),
      STAFF, ORIGIN,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'confirmed', queue_position: 0 });
    // Same action as the roster: one operation, one history. The screen is in
    // the diff instead, because the two screens are open to different roles.
    expect(audit.action).toBe('session_signup.desk');
    expect(audit.diff.via).toBe('events');
  });

  it('passes the waitlist answer straight through', async () => {
    const res = await handleEventsSignupCreate(
      post({ schedule_item_id: S1, attendee_id: A1 }),
      rpcClient({ data: [{ status: 'waitlisted', queue_position: 3 }] }),
      STAFF, ORIGIN,
    );
    expect(await res.json()).toEqual({ status: 'waitlisted', queue_position: 3 });
  });

  it('refuses a session that is not bookable', async () => {
    const res = await handleEventsSignupCreate(
      post({ schedule_item_id: S1, attendee_id: A1 }),
      rpcClient({ error: { message: 'session_not_bookable' } }),
      STAFF, ORIGIN,
    );
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toBe('session_not_bookable');
  });

  it('rejects ids that are not ids, including a body that is not JSON', async () => {
    const client = rpcClient({ data: [] });
    for (const body of [{ schedule_item_id: 'nope', attendee_id: A1 }, { schedule_item_id: S1, attendee_id: 'nope' }, {}]) {
      const res = await handleEventsSignupCreate(post(body), client, STAFF, ORIGIN);
      expect(res.status).toBe(400);
    }
    const broken = new Request('https://x', { method: 'POST', body: 'not json' });
    expect((await handleEventsSignupCreate(broken, client, STAFF, ORIGIN)).status).toBe(400);
  });

  it('removes somebody and reports who moved up', async () => {
    let audit: any = null;
    const res = await handleEventsSignupRemove(
      new Request('https://x', { method: 'DELETE', body: JSON.stringify({ schedule_item_id: S1, attendee_id: A1 }) }),
      ENV, CTX,
      rpcClient({ data: [{ cancelled: true, promoted_attendee_id: A3 }] }, (row) => { audit = row; }),
      STAFF, ORIGIN,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true, promoted_attendee_id: A3 });
    expect(audit.action).toBe('session_signup.remove');
    expect(audit.diff.via).toBe('events');
  });

  it('reports a removal that matched nobody rather than pretending', async () => {
    const res = await handleEventsSignupRemove(
      new Request('https://x', { method: 'DELETE', body: JSON.stringify({ schedule_item_id: S1, attendee_id: A1 }) }),
      ENV, CTX, rpcClient({ data: [{ cancelled: false, promoted_attendee_id: null }] }), STAFF, ORIGIN,
    );
    expect(await res.json()).toEqual({ removed: false, promoted_attendee_id: null });
  });
});
