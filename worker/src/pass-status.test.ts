import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./editions', () => ({ getLatestEdition: vi.fn() }));

import { serviceClient } from './supabase';
import { getLatestEdition } from './editions';
import { handlePassStatus } from './pass-status';

const SECRET = 'shared-secret';

function mockEnv(overrides: Record<string, unknown> = {}) {
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x', REPLAY_TO_BGC_SECRET: SECRET, ...overrides } as any;
}

function req(body: unknown, auth: string | null = `Bearer ${SECRET}`) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://api.replaycon.in/api/pass-status', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

let regFilters: Record<string, unknown>;

function mockSupabase(regs: Array<{ pass_type: string; days: string[] | null }> | null, error: unknown = null) {
  regFilters = {};
  const chain: any = {
    eq: (col: string, val: unknown) => {
      regFilters[col] = val;
      return chain;
    },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: regs, error }),
  };
  return { from: () => ({ select: () => chain }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getLatestEdition as any).mockResolvedValue({ id: 'ed-3', slug: 'replay-3', name: 'REPLAY 3' });
});

describe('handlePassStatus', () => {
  it('rejects a request without the shared secret', async () => {
    const res = await handlePassStatus(req({ phone: '9876543210' }, null), mockEnv());
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong secret', async () => {
    const res = await handlePassStatus(req({ phone: '9876543210' }, 'Bearer nope'), mockEnv());
    expect(res.status).toBe(401);
  });

  it('rejects every request when the secret is unset', async () => {
    const res = await handlePassStatus(req({ phone: '9876543210' }, 'Bearer '), mockEnv({ REPLAY_TO_BGC_SECRET: '' }));
    expect(res.status).toBe(401);
  });

  it('returns no pass for an invalid phone', async () => {
    const res = await handlePassStatus(req({ phone: '123' }), mockEnv());
    expect(await res.json()).toMatchObject({ has_pass: false });
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it('returns no pass when there is no edition at all', async () => {
    (getLatestEdition as any).mockResolvedValue(null);
    const res = await handlePassStatus(req({ phone: '9876543210' }), mockEnv());
    expect(await res.json()).toMatchObject({ has_pass: false, edition_slug: null });
  });

  it('only counts confirmed registrations for the latest edition', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase([{ pass_type: 'oneshot', days: ['day1'] }]));
    const res = await handlePassStatus(req({ phone: '+91 98765 43210' }), mockEnv());

    expect(regFilters).toEqual({
      edition_id: 'ed-3',
      user_phone: '9876543210',
      payment_status: 'confirmed',
    });
    expect(await res.json()).toEqual({
      has_pass: true,
      edition_slug: 'replay-3',
      edition_name: 'REPLAY 3',
      pass_type: 'oneshot',
      days: ['day1'],
    });
  });

  it('reports no pass but names the edition when nothing is confirmed', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase([]));
    const res = await handlePassStatus(req({ phone: '9876543210' }), mockEnv());
    expect(await res.json()).toEqual({
      has_pass: false,
      edition_slug: 'replay-3',
      edition_name: 'REPLAY 3',
      pass_type: null,
      days: [],
    });
  });

  it('reports the campaign pass and merged days when someone holds two', async () => {
    (serviceClient as any).mockReturnValue(
      mockSupabase([
        { pass_type: 'oneshot', days: ['day2'] },
        { pass_type: 'campaign', days: ['day1', 'day2'] },
      ]),
    );
    const res = await handlePassStatus(req({ phone: '9876543210' }), mockEnv());
    expect(await res.json()).toMatchObject({ has_pass: true, pass_type: 'campaign', days: ['day1', 'day2'] });
  });

  it('surfaces a lookup failure', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase(null, { message: 'boom' }));
    const res = await handlePassStatus(req({ phone: '9876543210' }), mockEnv());
    expect(res.status).toBe(500);
  });
});
