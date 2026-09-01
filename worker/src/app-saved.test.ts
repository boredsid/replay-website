import { describe, it, expect, vi, beforeEach } from 'vitest';

const sbMock = { from: vi.fn() };
vi.mock('./supabase', () => ({ serviceClient: () => sbMock }));
vi.mock('./attendee-auth', () => ({ authenticateDevice: vi.fn() }));

import { handleMySaved, handleSaveItem, handleUnsaveItem, handleMergeSaved } from './app-saved';
import { authenticateDevice } from './attendee-auth';

const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const env = {} as never;

const auth = authenticateDevice as unknown as ReturnType<typeof vi.fn>;

interface Fixture {
  saved?: string[];
  known?: string[];
  upsertError?: { code?: string } | null;
  onUpsert?: (rows: Array<Record<string, unknown>>) => void;
  onDelete?: (filters: Array<[string, unknown]>) => void;
}

function tables(f: Fixture = {}) {
  sbMock.from.mockImplementation((table: string) => {
    if (table === 'saved_items') return {
      select: () => ({
        eq: async () => ({
          data: (f.saved ?? []).map((id) => ({ schedule_item_id: id })),
          error: null,
        }),
      }),
      upsert: async (rows: Array<Record<string, unknown>>) => {
        f.onUpsert?.(Array.isArray(rows) ? rows : [rows]);
        return { error: f.upsertError ?? null };
      },
      delete: () => {
        const filters: Array<[string, unknown]> = [];
        const eq = (column: string, value: unknown) => {
          filters.push([column, value]);
          f.onDelete?.(filters);
          return { eq, error: null, then: undefined };
        };
        // Two chained eq()s, and the second is what the caller awaits.
        return {
          eq: (c1: string, v1: unknown) => {
            filters.push([c1, v1]);
            return {
              eq: async (c2: string, v2: unknown) => {
                filters.push([c2, v2]);
                f.onDelete?.(filters);
                return { error: null };
              },
            };
          },
        };
      },
    };
    if (table === 'schedule_items') return {
      select: () => ({
        in: async (_column: string, ids: string[]) => ({
          data: (f.known ?? ids).map((id) => ({ id })),
          error: null,
        }),
      }),
    };
    throw new Error(`unexpected table ${table}`);
  });
}

function signedIn() {
  auth.mockResolvedValue({ ok: true, identity: { attendee_id: ATTENDEE, edition_id: 'ed-1', device_id: 'd1' } });
}

const get = () => new Request('https://api/api/app/me/saved');
const put = () => new Request('https://api/api/app/saved/x', { method: 'PUT' });
const del = () => new Request('https://api/api/app/saved/x', { method: 'DELETE' });
const merge = (body: unknown) =>
  new Request('https://api/api/app/saved/merge', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  sbMock.from.mockReset();
  auth.mockReset();
  signedIn();
});

describe('reading the starred list', () => {
  it('returns this attendee\'s stars', async () => {
    tables({ saved: [SESSION, OTHER] });
    const body = await (await handleMySaved(get(), env)).json() as { saved: string[] };
    expect(body.saved).toEqual([SESSION, OTHER]);
  });

  it('refuses without a device token', async () => {
    auth.mockResolvedValue({ ok: false, error: 'unauthorised' });
    expect((await handleMySaved(get(), env)).status).toBe(401);
  });

  it('does not cost a pairing when the database is merely unwell', async () => {
    // 401 makes the app throw its token away and start the wizard again. A
    // query that failed is not a reason to do that.
    auth.mockResolvedValue({ ok: false, error: 'query_failed' });
    expect((await handleMySaved(get(), env)).status).toBe(503);
  });
});

describe('starring', () => {
  it('stores the star against this attendee', async () => {
    let rows: Array<Record<string, unknown>> = [];
    tables({ onUpsert: (r) => { rows = r; } });
    const response = await handleSaveItem(put(), env, SESSION);
    expect(response.status).toBe(200);
    expect(rows).toEqual([{ attendee_id: ATTENDEE, schedule_item_id: SESSION }]);
  });

  it('treats starring twice as starring once', async () => {
    tables();
    expect((await handleSaveItem(put(), env, SESSION)).status).toBe(200);
    expect((await handleSaveItem(put(), env, SESSION)).status).toBe(200);
  });

  it('rejects an id that is not a uuid before touching the database', async () => {
    tables();
    const response = await handleSaveItem(put(), env, 'not-a-uuid');
    expect(response.status).toBe(400);
    expect(sbMock.from).not.toHaveBeenCalled();
  });

  it('reports a star on a session that no longer exists as a 404', async () => {
    tables({ upsertError: { code: '23503' } });
    expect((await handleSaveItem(put(), env, SESSION)).status).toBe(404);
  });

  it('unstars only this attendee\'s row', async () => {
    let filters: Array<[string, unknown]> = [];
    tables({ onDelete: (f) => { filters = f; } });
    const response = await handleUnsaveItem(del(), env, SESSION);
    expect(response.status).toBe(200);
    // Without the attendee filter this would unstar the session for everyone.
    expect(filters).toEqual([['attendee_id', ATTENDEE], ['schedule_item_id', SESSION]]);
  });
});

describe('merging a phone\'s list', () => {
  it('adds the phone\'s stars and returns the union', async () => {
    let rows: Array<Record<string, unknown>> = [];
    tables({ saved: [SESSION, OTHER], onUpsert: (r) => { rows = r; } });
    const body = await (await handleMergeSaved(merge({ schedule_item_ids: [SESSION] }), env)).json() as { saved: string[] };
    expect(rows).toEqual([{ attendee_id: ATTENDEE, schedule_item_id: SESSION }]);
    // The union, not the phone's list: pairing a second device must not wipe
    // what was starred on the first.
    expect(body.saved).toEqual([SESSION, OTHER]);
  });

  it('drops ids for sessions that no longer exist', async () => {
    let rows: Array<Record<string, unknown>> = [];
    // A stale phone can hold a deleted session's id, and one bad id would fail
    // the whole insert on the foreign key -- losing every other star with it.
    tables({ known: [SESSION], onUpsert: (r) => { rows = r; } });
    await handleMergeSaved(merge({ schedule_item_ids: [SESSION, OTHER] }), env);
    expect(rows).toEqual([{ attendee_id: ATTENDEE, schedule_item_id: SESSION }]);
  });

  it('ignores anything that is not a uuid', async () => {
    let called = false;
    tables({ onUpsert: () => { called = true; } });
    const response = await handleMergeSaved(merge({ schedule_item_ids: ['', 42, null] }), env);
    expect(response.status).toBe(200);
    expect(called).toBe(false);
  });

  it('accepts an empty list', async () => {
    tables({ saved: [OTHER] });
    const body = await (await handleMergeSaved(merge({ schedule_item_ids: [] }), env)).json() as { saved: string[] };
    expect(body.saved).toEqual([OTHER]);
  });

  it('refuses a list too long to be a real agenda', async () => {
    tables();
    const tooMany = Array.from({ length: 501 }, () => SESSION);
    expect((await handleMergeSaved(merge({ schedule_item_ids: tooMany }), env)).status).toBe(400);
  });

  it('refuses a body that is not a list', async () => {
    tables();
    expect((await handleMergeSaved(merge({ schedule_item_ids: 'all' }), env)).status).toBe(400);
  });
});
