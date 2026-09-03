import { describe, it, expect, vi, beforeEach } from 'vitest';

const sbMock = { from: vi.fn(), rpc: vi.fn() };
vi.mock('./supabase', () => ({ serviceClient: () => sbMock }));
vi.mock('./editions', () => ({ getCurrentEdition: vi.fn() }));
vi.mock('./attendee-auth', () => ({ authenticateDevice: vi.fn() }));
vi.mock('./attendee-gate', () => ({ attendeeGateDay: vi.fn() }));

import { handleLibraryState, handleLibraryRequest, handleLibraryCancel } from './app-library';
import { getCurrentEdition } from './editions';
import { authenticateDevice } from './attendee-auth';
import { attendeeGateDay } from './attendee-gate';

const EDITION = { id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' };
const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env = {} as never;

const auth = authenticateDevice as unknown as ReturnType<typeof vi.fn>;
const edition = getCurrentEdition as unknown as ReturnType<typeof vi.fn>;
const gate = attendeeGateDay as unknown as ReturnType<typeof vi.fn>;

const MINUTE = 60_000;

function loanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loan-1',
    status: 'requested',
    request_expires_at: new Date(Date.now() + 3 * MINUTE).toISOString(),
    due_at: null,
    library_copies: { copy_number: 2, library_titles: { key: 'bgg-1', title: 'Catan' } },
    ...overrides,
  };
}

function tables(loans: unknown[] = []) {
  sbMock.from.mockImplementation((table: string) => {
    if (table === 'library_loans') return {
      select: () => ({ eq: () => ({ in: async () => ({ data: loans, error: null }) }) }),
    };
    throw new Error(`unexpected table ${table}`);
  });
}

const get = () => new Request('https://api/api/app/library');
const post = (body: unknown) =>
  new Request('https://api/api/app/library/request', { method: 'POST', body: JSON.stringify(body) });
const del = () => new Request('https://api/api/app/library/request', { method: 'DELETE' });

beforeEach(() => {
  sbMock.from.mockReset();
  sbMock.rpc.mockReset();
  auth.mockReset(); edition.mockReset(); gate.mockReset();
  auth.mockResolvedValue({ ok: true, identity: { attendee_id: ATTENDEE, edition_id: EDITION.id, device_id: 'd1' } });
  edition.mockResolvedValue(EDITION);
  gate.mockResolvedValue('day1');
  sbMock.rpc.mockResolvedValue({ data: [], error: null });
});

describe('the shelf', () => {
  it('lists what is out, not what is in', async () => {
    // 586 titles and a few dozen loans: the absences are the small half, and
    // the only half that changes.
    tables();
    sbMock.rpc.mockResolvedValue({ data: ['bgg-1', 'bgg-2'], error: null });
    const body = await (await handleLibraryState(get(), env)).json() as { unavailable: string[] };
    expect(body.unavailable).toEqual(['bgg-1', 'bgg-2']);
  });

  it('unwraps the row form PostgREST returns for a set-returning function', async () => {
    tables();
    sbMock.rpc.mockResolvedValue({ data: [{ library_unavailable_keys: 'bgg-9' }], error: null });
    const body = await (await handleLibraryState(get(), env)).json() as { unavailable: string[] };
    expect(body.unavailable).toEqual(['bgg-9']);
  });

  it('reports a live hold with its deadline', async () => {
    tables([loanRow()]);
    const body = await (await handleLibraryState(get(), env)).json() as { hold: { title: string } | null };
    expect(body.hold).toMatchObject({ title: 'Catan', copy_number: 2 });
  });

  it('treats a lapsed hold as no hold', async () => {
    // Expiry is lazy, so the row is still 'requested'. Showing it would give
    // the attendee a countdown that finished a minute ago.
    tables([loanRow({ request_expires_at: new Date(Date.now() - MINUTE).toISOString() })]);
    const body = await (await handleLibraryState(get(), env)).json() as { hold: unknown };
    expect(body.hold).toBeNull();
  });

  it('reports an open loan and whether it is late', async () => {
    tables([loanRow({
      status: 'checked_out',
      due_at: new Date(Date.now() - MINUTE).toISOString(),
    })]);
    const body = await (await handleLibraryState(get(), env)).json() as { loan: { overdue: boolean } | null };
    expect(body.loan).toMatchObject({ overdue: true, title: 'Catan' });
  });

  it('says borrowing is shut to someone who has not checked in', async () => {
    gate.mockResolvedValue(null);
    tables();
    const body = await (await handleLibraryState(get(), env)).json() as { can_borrow: boolean };
    expect(body.can_borrow).toBe(false);
  });

  it('still returns the shelf when availability cannot be read', async () => {
    // The catalogue is on the device. A failed availability read should cost
    // accuracy, not the whole screen.
    tables();
    sbMock.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const response = await handleLibraryState(get(), env);
    expect(response.status).toBe(200);
    expect((await response.json() as { unavailable: string[] }).unavailable).toEqual([]);
  });
});

describe('requesting', () => {
  it('holds a copy and says when the hold runs out', async () => {
    const expires = new Date(Date.now() + 5 * MINUTE).toISOString();
    sbMock.rpc.mockResolvedValue({ data: [{ loan_id: 'l1', copy_id: 'c1', copy_number: 1, expires_at: expires }], error: null });
    const body = await (await handleLibraryRequest(post({ title_key: 'bgg-1' }), env)).json() as { expires_at: string };
    expect(body.expires_at).toBe(expires);
  });

  it('refuses someone who has not checked in today', async () => {
    gate.mockResolvedValue(null);
    const response = await handleLibraryRequest(post({ title_key: 'bgg-1' }), env);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not_checked_in' });
    // The gate must be checked before the database is asked to do anything.
    expect(sbMock.rpc).not.toHaveBeenCalled();
  });

  it('passes the last copy going to somebody else through as a conflict', async () => {
    sbMock.rpc.mockResolvedValue({ data: null, error: { message: 'no_copy_available' } });
    const response = await handleLibraryRequest(post({ title_key: 'bgg-1' }), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_copy_available' });
  });

  it('reports one-game-at-a-time as a conflict the app can word', async () => {
    sbMock.rpc.mockResolvedValue({ data: null, error: { message: 'already_holding' } });
    expect((await handleLibraryRequest(post({ title_key: 'bgg-1' }), env)).status).toBe(409);
  });

  it('maps an open loan onto the same message as an open hold', async () => {
    // "You already have a game" is one situation to the attendee, whichever
    // half of it the database happened to object to.
    sbMock.rpc.mockResolvedValue({ data: null, error: { message: 'already_borrowing' } });
    const response = await handleLibraryRequest(post({ title_key: 'bgg-1' }), env);
    expect(await response.json()).toEqual({ error: 'already_holding' });
  });

  it('reports last call rather than a generic failure', async () => {
    sbMock.rpc.mockResolvedValue({ data: null, error: { message: 'library_last_call' } });
    const response = await handleLibraryRequest(post({ title_key: 'bgg-1' }), env);
    expect(await response.json()).toEqual({ error: 'library_last_call' });
  });

  it('rejects a missing or absurd title key without a round trip', async () => {
    expect((await handleLibraryRequest(post({}), env)).status).toBe(400);
    expect((await handleLibraryRequest(post({ title_key: 'x'.repeat(101) }), env)).status).toBe(400);
    expect(sbMock.rpc).not.toHaveBeenCalled();
  });

  it('refuses without a device token', async () => {
    auth.mockResolvedValue({ ok: false, error: 'unauthorised' });
    expect((await handleLibraryRequest(post({ title_key: 'bgg-1' }), env)).status).toBe(401);
  });

  it('does not cost a pairing when the database is merely unwell', async () => {
    auth.mockResolvedValue({ ok: false, error: 'query_failed' });
    expect((await handleLibraryRequest(post({ title_key: 'bgg-1' }), env)).status).toBe(503);
  });
});

describe('cancelling', () => {
  it('gives the hold back', async () => {
    sbMock.rpc.mockResolvedValue({ data: true, error: null });
    expect(await (await handleLibraryCancel(del(), env)).json()).toEqual({ cancelled: true });
  });

  it('is not an error when there was nothing to cancel', async () => {
    sbMock.rpc.mockResolvedValue({ data: false, error: null });
    const response = await handleLibraryCancel(del(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: false });
  });
});
