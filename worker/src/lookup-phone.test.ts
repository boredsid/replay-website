import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./bgc-client', () => ({ fetchGuildStatus: vi.fn() }));

import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { handleLookupPhone } from './lookup-phone';

function mockEnv() {
  return {
    SUPABASE_URL: 'x',
    SUPABASE_SERVICE_KEY: 'x',
    BGC_WORKER_URL: 'x',
    REPLAY_TO_BGC_SECRET: 'x',
  } as any;
}

function mockSupabase(opts: {
  user?: { phone: string; name: string | null; email: string | null } | null;
  existingRegs?: Array<{ payment_status: string }>;
}) {
  const user = opts.user ?? null;
  const regs = opts.existingRegs ?? [];
  return {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: user, error: null }),
            }),
          }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: async () => ({ data: regs, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleLookupPhone', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '12', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('returns user.found=false for unknown phone', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({ user: null }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.user.found).toBe(false);
    expect(body.guild.active).toBe(false);
    expect(body.existing_for_edition.count).toBe(0);
    expect(body.discount_blocked).toBe(false);
  });

  it('active guild + no prior regs => discount_blocked=false', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      user: { phone: '9876543210', name: 'Asha', email: 'a@b.c' },
      existingRegs: [],
    }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'adventurer', active: true });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    const body: any = await res.json();
    expect(body.user.found).toBe(true);
    expect(body.guild).toEqual({ tier: 'adventurer', active: true });
    expect(body.discount_blocked).toBe(false);
  });

  it('active guild + prior confirmed reg => discount_blocked=true', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      user: { phone: '9876543210', name: 'Asha', email: 'a@b.c' },
      existingRegs: [{ payment_status: 'confirmed' }],
    }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    const body: any = await res.json();
    expect(body.existing_for_edition.count).toBe(1);
    expect(body.existing_for_edition.has_confirmed).toBe(true);
    expect(body.discount_blocked).toBe(true);
  });

  it('inactive guild + prior reg => discount_blocked=false (no discount to block)', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      user: { phone: '9876543210', name: 'Asha', email: 'a@b.c' },
      existingRegs: [{ payment_status: 'pending' }],
    }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    const body: any = await res.json();
    expect(body.discount_blocked).toBe(false);
  });
});
