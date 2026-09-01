import { describe, expect, it } from 'vitest';
import {
  handleCheckIn,
  handleCheckInBulk,
  handleCheckInUndo,
  matchingRegistrationIds,
  normalizePhone,
  maskPhone,
  seatLabel,
} from './check-in';

const ORIGIN = 'https://admin.replaycon.in';
const ATTENDEE = '11111111-1111-1111-1111-111111111111';
const CLIENT_EVENT = '22222222-2222-2222-2222-222222222222';
const STAFF = 'staff@replaycon.in';

/**
 * Minimal Supabase double. `attendeeRow` is the seat being checked in;
 * `insertResult` lets a test force the unique-violation the offline queue hits.
 */
function makeClient(options: {
  attendeeRow?: any;
  insertError?: { code?: string; message?: string };
  existingEvent?: { id: string };
  phoneClash?: any[];
  onUpdate?: (patch: any) => void;
  onInsert?: (row: any) => void;
  onAudit?: (row: any) => void;
} = {}) {
  const attendeeRow = options.attendeeRow ?? {
    id: ATTENDEE, edition_id: 'ed-1', seat_index: 2, display_name: null, phone: null, registration_id: 'reg-1',
  };
  return {
    from: (table: string) => {
      if (table === 'attendees') return {
        select: () => ({
          eq: (col: string, _v: string) => {
            if (col === 'id') return { maybeSingle: async () => ({ data: attendeeRow, error: null }) };
            // the duplicate-phone lookup
            return { eq: () => ({ neq: () => ({ limit: async () => ({ data: options.phoneClash ?? [], error: null }) }) }) };
          },
        }),
        update: (patch: any) => {
          options.onUpdate?.(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
      if (table === 'check_in_events') return {
        insert: (row: any) => {
          options.onInsert?.(row);
          if (options.insertError) {
            return { select: () => ({ single: async () => ({ data: null, error: options.insertError }) }) };
          }
          return { select: () => ({ single: async () => ({ data: { id: 'event-1' }, error: null }) }) };
        },
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: options.existingEvent ?? null, error: null }) }),
        }),
      };
      if (table === 'admin_audit_log') return {
        insert: async (row: any) => { options.onAudit?.(row); return { error: null }; },
      };
      throw new Error(`unexpected table ${table}`);
    },
  } as any;
}

function checkInRequest(body: Record<string, unknown>) {
  return new Request('https://x/api/admin/check-in', { method: 'POST', body: JSON.stringify(body) });
}

const VALID = { attendee_id: ATTENDEE, day: 'day1', kind: 'in', client_event_id: CLIENT_EVENT };

describe('phone and seat presentation', () => {
  it('reduces any format to ten digits so the same person is found either way', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone(null)).toBe('');
  });

  it('shows only the last four digits, so the desk never reads out a full number', () => {
    expect(maskPhone('9876543210')).toBe('••••3210');
    expect(maskPhone(null)).toBeNull();
  });

  it('labels an unnamed seat rather than leaving it blank', () => {
    expect(seatLabel(null, 2)).toBe('Guest 2');
    expect(seatLabel('   ', 3)).toBe('Guest 3');
    expect(seatLabel('Priya', 2)).toBe('Priya');
  });
});

describe('handleCheckIn', () => {
  it('records an arrival and audits it against the staff member', async () => {
    let inserted: any; let audit: any;
    const sb = makeClient({ onInsert: (r) => { inserted = r; }, onAudit: (r) => { audit = r; } });
    const res = await handleCheckIn(checkInRequest(VALID), sb, STAFF, ORIGIN);

    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({ attendee_id: ATTENDEE, day: 'day1', kind: 'in', actor_email: STAFF });
    expect(audit.action).toBe('check_in.in');
  });

  it('writes the name and phone the desk collected in the same operation', async () => {
    let patch: any;
    const sb = makeClient({ onUpdate: (p) => { patch = p; } });
    const res = await handleCheckIn(
      checkInRequest({ ...VALID, display_name: '  Priya  ', phone: '+91 98765 43210' }),
      sb, STAFF, ORIGIN,
    );

    expect(res.status).toBe(200);
    expect(patch).toEqual({ display_name: 'Priya', phone: '9876543210' });
  });

  it('checks in fine with no name or phone — capture is a prompt, not a gate', async () => {
    let updated = false;
    const sb = makeClient({ onUpdate: () => { updated = true; } });
    const res = await handleCheckIn(checkInRequest(VALID), sb, STAFF, ORIGIN);

    expect(res.status).toBe(200);
    expect(updated).toBe(false);
  });

  it('warns but still succeeds when the phone belongs to another attendee', async () => {
    const sb = makeClient({ phoneClash: [{ id: 'other', seat_index: 1, display_name: 'Arjun' }] });
    const res = await handleCheckIn(
      checkInRequest({ ...VALID, phone: '9876543210' }),
      sb, STAFF, ORIGIN,
    );

    expect(res.status).toBe(200);
    // Couples and families share numbers; this must never block an arrival.
    expect(await res.json()).toMatchObject({ warning: 'phone_already_used_by:Arjun' });
  });

  it('returns the original event when an offline queue replays the same id', async () => {
    const sb = makeClient({
      insertError: { code: '23505', message: 'duplicate key' },
      existingEvent: { id: 'event-original' },
    });
    const res = await handleCheckIn(checkInRequest(VALID), sb, STAFF, ORIGIN);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ event_id: 'event-original', deduped: true });
  });

  it('surfaces a day the ticket does not cover as a conflict, not a server error', async () => {
    const sb = makeClient({ insertError: { message: 'day_not_purchased:day2' } });
    const res = await handleCheckIn(checkInRequest({ ...VALID, day: 'day2' }), sb, STAFF, ORIGIN);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'day_not_purchased' });
  });

  it.each([
    ['attendee_id', { ...VALID, attendee_id: 'not-a-uuid' }, 'invalid_attendee_id'],
    ['client_event_id', { ...VALID, client_event_id: 'nope' }, 'invalid_client_event_id'],
    ['day', { ...VALID, day: 'day3' }, 'invalid_day'],
    ['kind', { ...VALID, kind: 'maybe' }, 'invalid_kind'],
    ['phone', { ...VALID, phone: '12345' }, 'invalid_phone'],
  ])('rejects a bad %s', async (_field, body, expected) => {
    const res = await handleCheckIn(checkInRequest(body), makeClient(), STAFF, ORIGIN);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expected });
  });
});

describe('handleCheckInBulk', () => {
  it('reports per attendee so one bad seat does not stop the group', async () => {
    const bad = '33333333-3333-3333-3333-333333333333';
    const sb: any = {
      from: (table: string) => {
        if (table === 'attendees') return {
          select: () => ({
            eq: (col: string, value: string) => col === 'id'
              ? { maybeSingle: async () => ({
                  data: value === bad ? null : { id: value, edition_id: 'ed-1', seat_index: 1, display_name: null, phone: null, registration_id: 'reg-1' },
                  error: null,
                }) }
              : { eq: () => ({ neq: () => ({ limit: async () => ({ data: [], error: null }) }) }) },
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
        if (table === 'check_in_events') return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'e' }, error: null }) }) }),
        };
        if (table === 'admin_audit_log') return { insert: async () => ({ error: null }) };
        throw new Error(`unexpected table ${table}`);
      },
    };

    const req = new Request('https://x/api/admin/check-in/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries: [
        { ...VALID },
        { attendee_id: bad, day: 'day1', kind: 'in', client_event_id: '44444444-4444-4444-4444-444444444444' },
      ] }),
    });
    const res = await handleCheckInBulk(req, sb, STAFF, ORIGIN);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.results[0]).toMatchObject({ ok: true });
    expect(body.results[1]).toMatchObject({ ok: false, error: 'attendee_not_found' });
  });

  it('rejects an empty batch', async () => {
    const req = new Request('https://x/api/admin/check-in/bulk', { method: 'POST', body: JSON.stringify({ entries: [] }) });
    const res = await handleCheckInBulk(req, makeClient(), STAFF, ORIGIN);
    expect(res.status).toBe(400);
  });
});

describe('handleCheckInUndo', () => {
  it('appends a voiding row rather than deleting the original', async () => {
    let inserted: any;
    const sb: any = {
      from: (table: string) => {
        if (table === 'check_in_events') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'event-1', attendee_id: ATTENDEE, edition_id: 'ed-1', day: 'day1', kind: 'in' }, error: null,
          }) }) }),
          insert: (row: any) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'event-2' }, error: null }) }) };
          },
        };
        if (table === 'admin_audit_log') return { insert: async () => ({ error: null }) };
        throw new Error(`unexpected table ${table}`);
      },
    };

    const req = new Request('https://x/api/admin/check-in/undo', {
      method: 'POST',
      body: JSON.stringify({ event_id: '55555555-5555-5555-5555-555555555555', client_event_id: CLIENT_EVENT }),
    });
    const res = await handleCheckInUndo(req, sb, STAFF, ORIGIN);

    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({ voids_event_id: 'event-1', attendee_id: ATTENDEE, day: 'day1' });
  });
});

/**
 * Chainable Supabase double for search. Each fixture key is a table plus the
 * filter that defines the branch, e.g. `registrations|in:user_phone`, so a test
 * asserts which route found the person rather than how the query was built.
 */
function makeSearchClient(fixtures: Record<string, any[]>) {
  const queried: string[] = [];
  function node(table: string, ops: string[]): any {
    const rec = (op: string) => node(table, [...ops, op]);
    return {
      select: () => rec('select'),
      eq: (col: string) => rec(`eq:${col}`),
      limit: () => rec('limit'),
      like: (col: string) => rec(`like:${col}`),
      ilike: (col: string) => rec(`ilike:${col}`),
      in: (col: string) => rec(`in:${col}`),
      then: (resolve: (value: any) => void) => {
        const filter = [...ops].reverse().find((op) => /^(like|ilike|in):/.test(op)) ?? 'none';
        const key = `${table}|${filter}`;
        queried.push(key);
        resolve({ data: fixtures[key] ?? [], error: null });
      },
    };
  }
  return { sb: { from: (table: string) => node(table, []) } as any, queried };
}

describe('matchingRegistrationIds', () => {
  it('finds the buyer by name when their seat is still anonymous', async () => {
    // The seat carries no name, so the only trace of "Siddhant" is the account.
    const { sb, queried } = makeSearchClient({
      'users|ilike:name': [{ phone: '9982200768' }],
      'registrations|in:user_phone': [{ id: 'reg-live' }],
      'attendees|ilike:display_name': [],
    });

    const ids = await matchingRegistrationIds(sb, 'ed-1', 'Siddhant');

    expect([...ids!]).toEqual(['reg-live']);
    expect(queried).toContain('users|ilike:name');
  });

  it('still finds a seat named at the desk, whoever bought it', async () => {
    const { sb } = makeSearchClient({
      'users|ilike:name': [],
      'attendees|ilike:display_name': [{ registration_id: 'reg-guest' }],
    });

    const ids = await matchingRegistrationIds(sb, 'ed-1', 'Priya');

    expect([...ids!]).toEqual(['reg-guest']);
  });

  it('does not go looking for accounts when the query is a phone number', async () => {
    const { sb, queried } = makeSearchClient({
      'registrations|like:user_phone': [{ id: 'reg-live' }],
      'attendees|like:phone': [],
    });

    const ids = await matchingRegistrationIds(sb, 'ed-1', '9982200768');

    expect([...ids!]).toEqual(['reg-live']);
    expect(queried).not.toContain('users|ilike:name');
  });
});
