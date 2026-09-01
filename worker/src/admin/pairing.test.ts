import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../editions', () => ({ getCurrentEdition: vi.fn() }));

import { editionDayForToday, pairingGateDay, handlePairingCodeIssue, handleScan } from './pairing';
import { getCurrentEdition } from '../editions';

const ORIGIN = 'https://admin.replaycon.in';
const STAFF = 'staff@replaycon.in';
const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EDITION = { id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' };
const env = {} as never;

const currentEdition = getCurrentEdition as unknown as ReturnType<typeof vi.fn>;

describe('editionDayForToday', () => {
  it('maps the two event dates onto their days', () => {
    // Midday IST on each date.
    expect(editionDayForToday(EDITION, new Date('2026-09-12T06:30:00Z'))).toBe('day1');
    expect(editionDayForToday(EDITION, new Date('2026-09-13T06:30:00Z'))).toBe('day2');
  });

  it('is null outside the event', () => {
    expect(editionDayForToday(EDITION, new Date('2026-09-11T06:30:00Z'))).toBeNull();
    expect(editionDayForToday(EDITION, new Date('2026-09-14T06:30:00Z'))).toBeNull();
  });

  it('uses IST, not UTC, for the day boundary', () => {
    // 20:00 UTC on the 11th is already 01:30 on the 12th in Bangalore, where the
    // event and its staff actually are.
    expect(editionDayForToday(EDITION, new Date('2026-09-11T20:00:00Z'))).toBe('day1');
    // And 19:00 UTC on the 13th is past midnight IST, so the event is over.
    expect(editionDayForToday(EDITION, new Date('2026-09-13T19:00:00Z'))).toBeNull();
  });
});

interface IssueFixture {
  events?: Array<Record<string, unknown>>;
  attendeeRow?: Record<string, unknown> | null;
  onConsume?: () => void;
  onInsert?: (row: Record<string, unknown>) => void;
  onAudit?: (row: Record<string, unknown>) => void;
}

function issueClient(f: IssueFixture = {}) {
  const attendeeRow = f.attendeeRow === undefined
    ? { id: ATTENDEE, edition_id: EDITION.id, seat_index: 2, display_name: 'Priya', registration_id: 'reg-1' }
    : f.attendeeRow;
  return {
    from: (table: string) => {
      if (table === 'attendees') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: attendeeRow, error: null }) }) }),
      };
      if (table === 'check_in_events') return {
        select: () => ({ eq: async () => ({ data: f.events ?? [], error: null }) }),
      };
      if (table === 'registrations') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { days: ['day1', 'day2'] }, error: null }) }) }),
      };
      if (table === 'pairing_codes') return {
        update: () => ({ eq: () => ({ is: async () => { f.onConsume?.(); return { error: null }; } }) }),
        insert: async (row: Record<string, unknown>) => { f.onInsert?.(row); return { error: null }; },
      };
      if (table === 'admin_audit_log') return {
        insert: async (row: Record<string, unknown>) => { f.onAudit?.(row); return { error: null }; },
      };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function issueRequest(attendeeId: string = ATTENDEE) {
  return new Request('https://x', { method: 'POST', body: JSON.stringify({ attendee_id: attendeeId }) });
}

const ARRIVED = [{ id: 'e1', day: 'day1', kind: 'in', voids_event_id: null, occurred_at: '2026-09-12T04:00:00Z' }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-09-12T06:30:00Z'));
  currentEdition.mockResolvedValue(EDITION);
});

describe('handlePairingCodeIssue', () => {
  it('issues a code labelled with the attendee, so the desk can tell two apart', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T06:30:00Z'));
    let inserted: Record<string, unknown> | undefined;
    const res = await handlePairingCodeIssue(
      issueRequest(), env, issueClient({ events: ARRIVED, onInsert: (r) => { inserted = r; } }), STAFF, ORIGIN,
    );
    const body = await res.json() as Record<string, string>;
    vi.useRealTimers();

    expect(res.status).toBe(200);
    expect(body.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(body.attendee_name).toBe('Priya');
    // Only the hash is stored.
    expect(inserted!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserted)).not.toContain(body.code);
  });

  it('retires any outstanding code first', async () => {
    let consumed = false;
    await handlePairingCodeIssue(
      issueRequest(), env, issueClient({ events: ARRIVED, onConsume: () => { consumed = true; } }), STAFF, ORIGIN,
    );
    // At most one live code per attendee, so a code read out earlier dies here.
    expect(consumed).toBe(true);
  });

  it('never writes the code into the audit log', async () => {
    let audit: Record<string, unknown> | undefined;
    const res = await handlePairingCodeIssue(
      issueRequest(), env, issueClient({ events: ARRIVED, onAudit: (r) => { audit = r; } }), STAFF, ORIGIN,
    );
    const body = await res.json() as Record<string, string>;

    expect(audit!.action).toBe('pairing_code.issue');
    expect(JSON.stringify(audit)).not.toContain(body.code);
  });

  it('refuses for someone who has not arrived today', async () => {
    const res = await handlePairingCodeIssue(issueRequest(), env, issueClient({ events: [] }), STAFF, ORIGIN);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_checked_in' });
  });

  it('still issues for someone who arrived and then stepped out', async () => {
    const events = [
      ...ARRIVED,
      { id: 'e2', day: 'day1', kind: 'out', voids_event_id: null, occurred_at: '2026-09-12T05:00:00Z' },
    ];
    const res = await handlePairingCodeIssue(issueRequest(), env, issueClient({ events }), STAFF, ORIGIN);
    // Lunch does not revoke your right to the app.
    expect(res.status).toBe(200);
  });

  it('issues outside the event so the flow can be rehearsed', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-01T06:30:00Z'));
    const res = await handlePairingCodeIssue(issueRequest(), env, issueClient({ events: ARRIVED }), STAFF, ORIGIN);
    vi.useRealTimers();
    // Nothing is bookable outside the event, so the in-the-building rule has
    // nothing to protect -- and rehearsing beats discovering problems at the door.
    expect(res.status).toBe(200);
  });

  it('still refuses outside the event for someone who never checked in', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-01T06:30:00Z'));
    const res = await handlePairingCodeIssue(issueRequest(), env, issueClient({ events: [] }), STAFF, ORIGIN);
    vi.useRealTimers();
    expect(res.status).toBe(409);
  });

  it('rejects a malformed attendee id', async () => {
    const res = await handlePairingCodeIssue(issueRequest('nope'), env, issueClient(), STAFF, ORIGIN);
    expect(res.status).toBe(400);
  });

  it('reports an unknown attendee', async () => {
    const res = await handlePairingCodeIssue(issueRequest(), env, issueClient({ attendeeRow: null }), STAFF, ORIGIN);
    expect(res.status).toBe(404);
  });
});

interface ScanFixture {
  credential?: Record<string, unknown> | null;
  attendee?: Record<string, unknown> | null;
  registration?: Record<string, unknown> | null;
  events?: Array<Record<string, unknown>>;
}

function scanClient(f: ScanFixture = {}) {
  const {
    credential = { attendee_id: ATTENDEE, edition_id: EDITION.id },
    attendee = { id: ATTENDEE, seat_index: 1, display_name: 'Priya', registration_id: 'reg-1' },
    registration = { pass_type: 'campaign', days: ['day1', 'day2'], payment_status: 'confirmed' },
  } = f;
  return {
    from: (table: string) => {
      if (table === 'attendee_credentials') return {
        select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: credential, error: null }) }) }) }),
      };
      if (table === 'attendees') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: attendee, error: null }) }) }),
      };
      if (table === 'registrations') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: registration, error: null }) }) }),
      };
      if (table === 'check_in_events') return {
        select: () => ({ eq: async () => ({ data: f.events ?? ARRIVED, error: null }) }),
      };
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function scanRequest(token: unknown = 'ABCD1234EFGH5678') {
  return new Request('https://x', { method: 'POST', body: JSON.stringify({ qr_token: token }) });
}

describe('handleScan', () => {
  it('names the holder so staff can eyeball them', async () => {
    const res = await handleScan(scanRequest(), env, scanClient(), ORIGIN);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ name: 'Priya', pass_type: 'campaign', arrived_today: true });
  });

  it('returns no contact details at all', async () => {
    const res = await handleScan(scanRequest(), env, scanClient(), ORIGIN);
    const body = await res.json() as Record<string, unknown>;
    // The scanner needs to identify a person, not to read their file.
    expect(Object.keys(body)).toEqual(
      expect.not.arrayContaining(['phone', 'email', 'registration_id', 'user_phone']),
    );
  });

  it('reports an unknown pass', async () => {
    const res = await handleScan(scanRequest(), env, scanClient({ credential: null }), ORIGIN);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'unknown_pass' });
  });

  it('refuses a pass from a previous edition', async () => {
    const res = await handleScan(
      scanRequest(), env, scanClient({ credential: { attendee_id: ATTENDEE, edition_id: 'ed-old' } }), ORIGIN,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'wrong_edition' });
  });

  it('refuses a pass whose registration is no longer confirmed', async () => {
    const res = await handleScan(
      scanRequest(), env,
      scanClient({ registration: { pass_type: 'oneshot', days: ['day1'], payment_status: 'cancelled' } }),
      ORIGIN,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_confirmed' });
  });

  it('rejects an empty token', async () => {
    const res = await handleScan(scanRequest(''), env, scanClient(), ORIGIN);
    expect(res.status).toBe(400);
  });
});

describe('pairingGateDay', () => {
  const DAY1_ONLY = ['day1'] as const;
  const BOTH = ['day1', 'day2'] as const;

  it('requires arriving today while the event is running', () => {
    const duringDay2 = new Date('2026-09-13T06:30:00Z');
    // Arrived on day 1 only; day 2 is running, so no code today.
    expect(pairingGateDay(EDITION, BOTH, ARRIVED, duringDay2)).toBeNull();
  });

  it('accepts today’s arrival while the event is running', () => {
    const day2Arrival = [{ id: 'e', day: 'day2', kind: 'in', voids_event_id: null, occurred_at: '2026-09-13T04:00:00Z' }];
    expect(pairingGateDay(EDITION, BOTH, day2Arrival, new Date('2026-09-13T06:30:00Z'))).toBe('day2');
  });

  it('accepts any covered day outside the event, so staff can rehearse', () => {
    expect(pairingGateDay(EDITION, BOTH, ARRIVED, new Date('2026-09-01T06:30:00Z'))).toBe('day1');
  });

  it('still needs an arrival outside the event', () => {
    expect(pairingGateDay(EDITION, BOTH, [], new Date('2026-09-01T06:30:00Z'))).toBeNull();
  });

  it('ignores an arrival on a day the ticket does not cover', () => {
    const day2Arrival = [{ id: 'e', day: 'day2', kind: 'in', voids_event_id: null, occurred_at: '2026-09-13T04:00:00Z' }];
    expect(pairingGateDay(EDITION, DAY1_ONLY, day2Arrival, new Date('2026-09-01T06:30:00Z'))).toBeNull();
  });

  it('still counts someone who arrived and stepped back out', () => {
    const inThenOut = [
      ...ARRIVED,
      { id: 'e2', day: 'day1', kind: 'out', voids_event_id: null, occurred_at: '2026-09-12T09:00:00Z' },
    ];
    expect(pairingGateDay(EDITION, BOTH, inThenOut, new Date('2026-09-01T06:30:00Z'))).toBe('day1');
  });
});
