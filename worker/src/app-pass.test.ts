import { describe, it, expect, vi, beforeEach } from 'vitest';

const sbMock = { from: vi.fn() };
vi.mock('./supabase', () => ({ serviceClient: () => sbMock }));
vi.mock('./editions', () => ({ getCurrentEdition: vi.fn() }));
vi.mock('./attendee-auth', () => ({ authenticateDevice: vi.fn() }));

import { handleMyPass, type PassDay } from './app-pass';
import { getCurrentEdition } from './editions';
import { authenticateDevice } from './attendee-auth';

const EDITION = { id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' };
const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env = {} as never;

const auth = authenticateDevice as unknown as ReturnType<typeof vi.fn>;
const currentEdition = getCurrentEdition as unknown as ReturnType<typeof vi.fn>;

const IN_DAY1 = { id: 'e1', day: 'day1', kind: 'in', voids_event_id: null, occurred_at: '2026-09-12T04:00:00Z' };
const OUT_DAY1 = { id: 'e2', day: 'day1', kind: 'out', voids_event_id: null, occurred_at: '2026-09-12T07:00:00Z' };

interface Fixture {
  days?: string[];
  passType?: string;
  events?: unknown[];
  displayName?: string | null;
  seatIndex?: number;
  registration?: null;
}

function tables(f: Fixture = {}) {
  sbMock.from.mockImplementation((table: string) => {
    if (table === 'attendees') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: {
          registration_id: 'reg-1',
          display_name: f.displayName === undefined ? 'Siddhant Narula' : f.displayName,
          seat_index: f.seatIndex ?? 1,
        },
        error: null,
      }) }) }),
    };
    if (table === 'check_in_events') return {
      select: () => ({ eq: async () => ({ data: f.events ?? [], error: null }) }),
    };
    if (table === 'registrations') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: f.registration === null ? null : { days: f.days ?? ['day1', 'day2'], pass_type: f.passType ?? 'campaign' },
        error: null,
      }) }) }),
    };
    throw new Error(`unexpected table ${table}`);
  });
}

const get = () => new Request('https://api/api/app/me/pass');

async function pass(f: Fixture = {}) {
  tables(f);
  const response = await handleMyPass(get(), env);
  return await response.json() as { display_name: string | null; pass_type: string | null; days: PassDay[] };
}

beforeEach(() => {
  sbMock.from.mockReset();
  auth.mockReset();
  currentEdition.mockReset();
  auth.mockResolvedValue({ ok: true, identity: { attendee_id: ATTENDEE, edition_id: EDITION.id, device_id: 'd1' } });
  currentEdition.mockResolvedValue(EDITION);
});

describe('the pass', () => {
  it('names the attendee from the record, not the stored device copy', async () => {
    // The desk can rename a seat after pairing, and a pass still reading
    // "Guest 2" at a door is worse than no pass.
    const body = await pass({ displayName: 'Renamed At Desk' });
    expect(body.display_name).toBe('Renamed At Desk');
  });

  it('gives both days their calendar dates', async () => {
    const body = await pass();
    expect(body.days.map((d) => d.date)).toEqual(['2026-09-12', '2026-09-13']);
  });

  it('lists the day a one-day ticket does not cover, rather than hiding it', async () => {
    // "Does my ticket cover Sunday" is the question the desk gets asked. It is
    // only answerable here if the uncovered day is shown at all.
    const body = await pass({ days: ['day1'], passType: 'oneshot' });
    expect(body.days.map((d) => d.covered)).toEqual([true, false]);
    expect(body.pass_type).toBe('oneshot');
  });

  it('says arrived for someone who checked in', async () => {
    const body = await pass({ events: [IN_DAY1] });
    expect(body.days[0]).toMatchObject({ arrived: true, present: 'in' });
    expect(body.days[1]).toMatchObject({ arrived: false, present: null });
  });

  it('keeps arrived true for someone who stepped out', async () => {
    // Presence and arrival are different questions. Lunch does not un-arrive
    // anybody, and the app must not tell them it did.
    const body = await pass({ events: [IN_DAY1, OUT_DAY1] });
    expect(body.days[0]).toMatchObject({ arrived: true, present: 'out' });
  });

  it('ignores an undone check-in', async () => {
    const undo = { id: 'e3', day: 'day1', kind: 'out', voids_event_id: 'e1', occurred_at: '2026-09-12T05:00:00Z' };
    const body = await pass({ events: [IN_DAY1, undo] });
    expect(body.days[0]).toMatchObject({ arrived: false, present: null });
  });

  it('reports a covered day nobody has arrived on yet', async () => {
    const body = await pass();
    expect(body.days.every((d) => d.covered && !d.arrived)).toBe(true);
  });

  it('survives a missing registration rather than failing the screen', async () => {
    // The pass still shows the name and the QR; it just cannot claim any day
    // is covered. Blanking the whole screen would be a worse answer.
    const body = await pass({ registration: null });
    expect(body.pass_type).toBeNull();
    expect(body.days.map((d) => d.covered)).toEqual([false, false]);
  });
});

describe('refusals', () => {
  it('refuses without a device token', async () => {
    auth.mockResolvedValue({ ok: false, error: 'unauthorised' });
    expect((await handleMyPass(get(), env)).status).toBe(401);
  });

  it('does not cost a pairing when the database is merely unwell', async () => {
    auth.mockResolvedValue({ ok: false, error: 'query_failed' });
    expect((await handleMyPass(get(), env)).status).toBe(503);
  });

  it('reports no current edition as unavailable, not unauthorised', async () => {
    currentEdition.mockResolvedValue(null);
    expect((await handleMyPass(get(), env)).status).toBe(503);
  });
});
