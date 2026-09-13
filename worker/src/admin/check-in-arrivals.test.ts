import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../editions', () => ({ getCurrentEdition: vi.fn() }));
vi.mock('./audit', () => ({ writeAudit: vi.fn(async () => {}) }));

import { handleCheckInArrivals, type ArrivalRow } from './check-in';
import { getCurrentEdition } from '../editions';
import { writeAudit } from './audit';

const ORIGIN = 'https://admin.replaycon.in';
const ADMIN = 'sid@replaycon.in';
const EDITION = { id: 'ed-1', slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13' };

type Row = Record<string, unknown>;

/**
 * A Supabase double that answers the four reads this handler makes.
 *
 * Filters are ignored except the ones the handler's correctness rests on —
 * every query is already scoped to one edition, and the test supplies the rows
 * that scope would have returned.
 */
function makeClient(tables: {
  registrations?: Row[];
  attendees?: Row[];
  check_in_events?: Row[];
  users?: Row[];
  error?: string;
}) {
  const rowsFor = (table: string) => (tables as Record<string, Row[] | undefined>)[table] ?? [];
  const result = (table: string) => async () =>
    tables.error === table
      ? { data: null, error: { message: 'boom' } }
      : { data: rowsFor(table), error: null };

  return {
    from: (table: string) => {
      const answer = result(table);
      // Every shape the handler builds: .eq().eq().limit(), .eq().limit(), .in().
      const chain: Record<string, unknown> = {
        eq: () => chain,
        in: answer,
        limit: answer,
        then: undefined,
      };
      return {
        select: () => chain,
        insert: async () => ({ error: null }),
      };
    },
  } as never;
}

function seat(overrides: Row = {}): Row {
  return {
    id: 'a1',
    seat_index: 1,
    display_name: 'Priya',
    phone: '9876543210',
    is_purchaser: true,
    registration_id: 'r1',
    ...overrides,
  };
}

function event(overrides: Row = {}): Row {
  return {
    id: 'e1',
    attendee_id: 'a1',
    day: 'day1',
    kind: 'in',
    voids_event_id: null,
    occurred_at: '2026-09-12T04:30:00.000Z',
    ...overrides,
  };
}

const REGISTRATION = {
  id: 'r1',
  user_phone: '9876543210',
  pass_type: 'campaign',
  days: ['day1', 'day2'],
  seats: 2,
};

const BUYER = { phone: '9876543210', name: 'Priya Nair', email: 'priya@example.com' };

async function arrivals(client: unknown, url = 'https://admin.replaycon.in/api/admin/check-in/arrivals') {
  const res = await handleCheckInArrivals(new Request(url), {} as never, client as never, ADMIN, ORIGIN);
  return { res, body: (await res.json()) as { arrivals?: ArrivalRow[]; error?: string; day?: string | null } };
}

beforeEach(() => {
  vi.mocked(getCurrentEdition).mockResolvedValue(EDITION as never);
  vi.mocked(writeAudit).mockClear();
});

describe('the arrivals list', () => {
  it('carries full phone numbers, which is the whole reason it exists', async () => {
    const { body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat()],
      check_in_events: [event()],
      users: [BUYER],
    }));

    expect(body.arrivals).toHaveLength(1);
    const row = body.arrivals![0];
    expect(row.phone).toBe('9876543210');
    expect(row.purchaser_phone).toBe('9876543210');
    // Nothing masked anywhere on the row: a masked number cannot be rung.
    expect(JSON.stringify(row)).not.toContain('••••');
  });

  it('names the buyer behind a guest seat, who is the only contact it has', async () => {
    const { body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat({ id: 'a2', seat_index: 2, display_name: 'Rahul', phone: null, is_purchaser: false })],
      check_in_events: [event({ attendee_id: 'a2' })],
      users: [BUYER],
    }));

    const row = body.arrivals![0];
    expect(row.phone).toBeNull();
    expect(row.purchaser_phone).toBe('9876543210');
    expect(row.purchaser_name).toBe('Priya Nair');
    expect(row.purchaser_email).toBe('priya@example.com');
  });

  it('leaves out a seat that was sold and never turned up', async () => {
    // The roster export answers "who was expected". This one answers "who is
    // here", so an absentee must not appear on it at all.
    const { body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat(), seat({ id: 'a2', seat_index: 2, display_name: null, phone: null, is_purchaser: false })],
      check_in_events: [event()],
      users: [BUYER],
    }));

    expect(body.arrivals!.map((a) => a.attendee_id)).toEqual(['a1']);
  });

  it('leaves out a seat whose registration is not confirmed', async () => {
    // The query filters on payment_status, so an unconfirmed booking simply has
    // no registration row to join to — its seats drop out here.
    const { body } = await arrivals(makeClient({
      registrations: [],
      attendees: [seat()],
      check_in_events: [event()],
      users: [],
    }));

    expect(body.arrivals).toEqual([]);
  });

  it('drops somebody whose arrival was undone', async () => {
    const { body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat()],
      check_in_events: [
        event(),
        event({ id: 'e2', voids_event_id: 'e1', occurred_at: '2026-09-12T04:31:00.000Z' }),
      ],
      users: [BUYER],
    }));

    expect(body.arrivals).toEqual([]);
  });

  it('keeps somebody who stepped out, and says when they left', async () => {
    const { body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat()],
      check_in_events: [
        event(),
        event({ id: 'e2', kind: 'out', occurred_at: '2026-09-12T08:00:00.000Z' }),
      ],
      users: [BUYER],
    }));

    const row = body.arrivals![0];
    expect(row.state.day1).toBe('out');
    // The arrival time is the first one, not overwritten by the exit.
    expect(row.arrived_at.day1).toBe('2026-09-12T04:30:00.000Z');
    expect(row.last_seen_at.day1).toBe('2026-09-12T08:00:00.000Z');
  });

  it('filters to one day when asked, and ignores a day nobody recognises', async () => {
    const client = makeClient({
      registrations: [REGISTRATION],
      attendees: [seat(), seat({ id: 'a2', seat_index: 2, is_purchaser: false })],
      check_in_events: [event(), event({ id: 'e2', attendee_id: 'a2', day: 'day2' })],
      users: [BUYER],
    });

    const sunday = await arrivals(client, 'https://x/api/admin/check-in/arrivals?day=day2');
    expect(sunday.body.day).toBe('day2');
    expect(sunday.body.arrivals!.map((a) => a.attendee_id)).toEqual(['a2']);

    const nonsense = await arrivals(client, 'https://x/api/admin/check-in/arrivals?day=day9');
    expect(nonsense.body.day).toBeNull();
    expect(nonsense.body.arrivals).toHaveLength(2);
  });

  it('puts the most recent movement first', async () => {
    const { body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat(), seat({ id: 'a2', seat_index: 2, is_purchaser: false })],
      check_in_events: [
        event({ occurred_at: '2026-09-12T04:00:00.000Z' }),
        event({ id: 'e2', attendee_id: 'a2', occurred_at: '2026-09-12T09:00:00.000Z' }),
      ],
      users: [BUYER],
    }));

    expect(body.arrivals!.map((a) => a.attendee_id)).toEqual(['a2', 'a1']);
  });

  it('records who pulled it', async () => {
    await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat()],
      check_in_events: [event()],
      users: [BUYER],
    }));

    expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor_email: ADMIN,
      action: 'check_in.arrivals_viewed',
    }));
  });

  it('still answers when the audit write falls over', async () => {
    // The rows are already assembled by then; refusing the organiser their own
    // attendee list because a log row would not insert helps nobody.
    vi.mocked(writeAudit).mockRejectedValueOnce(new Error('audit_write_failed'));
    const { res, body } = await arrivals(makeClient({
      registrations: [REGISTRATION],
      attendees: [seat()],
      check_in_events: [event()],
      users: [BUYER],
    }));

    expect(res.status).toBe(200);
    expect(body.arrivals).toHaveLength(1);
  });

  it('says so when there is no current edition', async () => {
    vi.mocked(getCurrentEdition).mockResolvedValue(null as never);
    const { res, body } = await arrivals(makeClient({}));
    expect(res.status).toBe(503);
    expect(body.error).toBe('no_current_edition');
  });

  it('fails rather than returning a half list when a query errors', async () => {
    const { res, body } = await arrivals(makeClient({ error: 'attendees' }));
    expect(res.status).toBe(500);
    expect(body.error).toBe('query_failed');
  });
});
