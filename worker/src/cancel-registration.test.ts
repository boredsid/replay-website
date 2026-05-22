import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
import { serviceClient } from './supabase';
import { handleCancelRegistration } from './cancel-registration';

function env() { return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any; }

function mockSupabase(opts: { reg?: any; updateCapture?: { row: any } }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.reg ?? null, error: null }),
        }),
      }),
      update: (row: any) => ({
        eq: async () => {
          if (opts.updateCapture) opts.updateCapture.row = row;
          return { error: null };
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleCancelRegistration', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '12' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(400);
  });

  it('returns 404 when registration not found', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({ reg: null }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(404);
  });

  it('returns 403 when phone does not match registration owner', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      reg: { id: 'r1', user_phone: '9999999999', payment_status: 'pending' },
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(403);
  });

  it('returns 409 when already cancelled', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      reg: { id: 'r1', user_phone: '9876543210', payment_status: 'cancelled' },
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(409);
  });

  it('cancels a valid pending registration', async () => {
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({
      reg: { id: 'r1', user_phone: '9876543210', payment_status: 'pending' },
      updateCapture: cap,
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(200);
    expect(cap.row.payment_status).toBe('cancelled');
    const body: any = await res.json();
    expect(body).toEqual({ ok: true, registration_id: 'r1' });
  });
});
