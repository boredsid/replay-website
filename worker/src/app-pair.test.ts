import { describe, it, expect, vi, beforeEach } from 'vitest';

const sbMock = { from: vi.fn() };
vi.mock('./supabase', () => ({ serviceClient: () => sbMock }));
vi.mock('./editions', () => ({ getCurrentEdition: vi.fn() }));

import { handleAppPair } from './app-pair';
import { getCurrentEdition } from './editions';
import { hashToken } from './attendee-tokens';

const EDITION = { id: 'ed-1', end_date: '2026-09-13' };
const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CODE = 'A1B2C3D4';

interface Fixture {
  codeRow?: Record<string, unknown> | null;
  attendeeRow?: Record<string, unknown> | null;
  consumeWins?: boolean;
  onInsert?: (table: string, row: Record<string, unknown>) => void;
  onRevoke?: (table: string) => void;
}

function setup(fixture: Fixture = {}) {
  const {
    codeRow = {
      id: 'code-1', attendee_id: ATTENDEE, edition_id: EDITION.id,
      expires_at: new Date(Date.now() + 120_000).toISOString(), consumed_at: null,
    },
    attendeeRow = { id: ATTENDEE, seat_index: 2, display_name: null },
    consumeWins = true,
  } = fixture;

  (getCurrentEdition as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(EDITION);

  sbMock.from.mockImplementation((table: string) => {
    if (table === 'pairing_codes') return {
      select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: codeRow, error: null }) }) }) }),
      update: () => ({
        eq: () => ({
          is: () => ({ select: () => ({ maybeSingle: async () => ({ data: consumeWins ? { id: 'code-1' } : null, error: null }) }) }),
          then: undefined,
        }),
      }),
    };
    if (table === 'attendees') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: attendeeRow, error: null }) }) }),
    };
    if (table === 'attendee_devices' || table === 'attendee_credentials') return {
      update: () => ({ eq: () => ({ is: async () => { fixture.onRevoke?.(table); return { error: null }; } }) }),
      insert: async (row: Record<string, unknown>) => { fixture.onInsert?.(table, row); return { error: null }; },
    };
    throw new Error(`unexpected table ${table}`);
  });
}

function pairRequest(code: unknown) {
  return new Request('https://api/api/app/pair', { method: 'POST', body: JSON.stringify({ code }) });
}

const env = {} as never;

beforeEach(() => { sbMock.from.mockReset(); vi.clearAllMocks(); });

describe('handleAppPair', () => {
  it('exchanges a valid code for a device token and a QR', async () => {
    const inserted: Record<string, Record<string, unknown>> = {};
    setup({ onInsert: (table, row) => { inserted[table] = row; } });

    const res = await handleAppPair(pairRequest(CODE), env);
    const body = await res.json() as Record<string, string>;

    expect(res.status).toBe(200);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.qr_token).toHaveLength(16);
    // Names the attendee back so a mistyped neighbour's code is visible at once.
    expect(body.display_name).toBe('Guest 2');
    // Only hashes reach the database.
    expect(inserted.attendee_devices.token_hash).toBe(await hashToken(body.token));
    expect(inserted.attendee_credentials.qr_token_hash).toBe(await hashToken(body.qr_token));
    expect(JSON.stringify(inserted)).not.toContain(body.token);
  });

  it('revokes any previous device and QR, so a lost phone stops working', async () => {
    const revoked: string[] = [];
    setup({ onRevoke: (table) => revoked.push(table) });

    await handleAppPair(pairRequest(CODE), env);

    expect(revoked).toContain('attendee_devices');
    expect(revoked).toContain('attendee_credentials');
  });

  it('accepts a code typed with the confusable characters', async () => {
    setup();
    // O for 0 and I for 1 are the classic misreads off a kiosk screen.
    const res = await handleAppPair(pairRequest('a1b2-c3d4'), env);
    expect(res.status).toBe(200);
  });

  it('refuses an expired code', async () => {
    setup({
      codeRow: {
        id: 'code-1', attendee_id: ATTENDEE, edition_id: EDITION.id,
        expires_at: new Date(Date.now() - 1000).toISOString(), consumed_at: null,
      },
    });
    const res = await handleAppPair(pairRequest(CODE), env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'pairing_failed' });
  });

  it('refuses an unknown code', async () => {
    setup({ codeRow: null });
    const res = await handleAppPair(pairRequest(CODE), env);
    expect(res.status).toBe(400);
  });

  it('refuses a code minted for a different edition', async () => {
    setup({
      codeRow: {
        id: 'code-1', attendee_id: ATTENDEE, edition_id: 'ed-old',
        expires_at: new Date(Date.now() + 120_000).toISOString(), consumed_at: null,
      },
    });
    const res = await handleAppPair(pairRequest(CODE), env);
    expect(res.status).toBe(400);
  });

  it('gives nothing to the loser of a race for one code', async () => {
    setup({ consumeWins: false });
    const res = await handleAppPair(pairRequest(CODE), env);
    // Single use has to mean single use, even under a simultaneous redemption.
    expect(res.status).toBe(400);
  });

  it.each([
    ['too short', 'A1B2C3D'],
    ['too long', 'A1B2C3D4E'],
    ['not a string', 12345678],
    ['empty', ''],
  ])('refuses a %s code without touching the database', async (_why, code) => {
    setup();
    const res = await handleAppPair(pairRequest(code), env);
    expect(res.status).toBe(400);
    expect(sbMock.from).not.toHaveBeenCalled();
  });

  it('returns an identical body for every failure mode', async () => {
    const bodies: string[] = [];
    for (const codeRow of [
      null,
      { id: 'c', attendee_id: ATTENDEE, edition_id: EDITION.id, expires_at: new Date(Date.now() - 1).toISOString(), consumed_at: null },
      { id: 'c', attendee_id: ATTENDEE, edition_id: 'other', expires_at: new Date(Date.now() + 1e5).toISOString(), consumed_at: null },
    ]) {
      setup({ codeRow });
      bodies.push(await (await handleAppPair(pairRequest(CODE), env)).text());
    }
    // Anything more specific tells a prober which guesses were close.
    expect(new Set(bodies).size).toBe(1);
  });
});
