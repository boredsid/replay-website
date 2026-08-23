import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
import { serviceClient } from './supabase';
import { handleLead } from './lead';

function env(overrides: Record<string, unknown> = {}) {
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x', ...overrides } as any;
}

function mockSupabase(opts: {
  editionExists?: boolean;
  upsertCapture?: { row: any; onConflict: string | null };
}) {
  const eventExists = opts.editionExists ?? true;
  return {
    from: (table: string) => {
      if (table === 'editions') {
        return {
          select: () => ({
            eq: (_c: string, v: string) => ({
              maybeSingle: async () => ({ data: eventExists ? { id: v } : null, error: null }),
            }),
          }),
        };
      }
      if (table === 'leads') {
        return {
          upsert: (row: any, opts2: any) => {
            if (opts.upsertCapture) {
              opts.upsertCapture.row = row;
              opts.upsertCapture.onConflict = opts2?.onConflict ?? null;
            }
            return { error: null };
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleLead', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '12', edition_id: 'e1', step_reached: 'phone_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(400);
  });

  it('rejects unknown edition with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({ editionExists: false }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', edition_id: 'missing', step_reached: 'phone_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(400);
  });

  it('rejects invalid step_reached with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', edition_id: 'e1', step_reached: 'bogus' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(400);
  });

  it('upserts a new lead with onConflict on (edition_id,phone)', async () => {
    const cap: any = { row: null, onConflict: null };
    (serviceClient as any).mockReturnValue(mockSupabase({ upsertCapture: cap }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', name: 'Asha', edition_id: 'e1', step_reached: 'name_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(200);
    expect(cap.onConflict).toBe('edition_id,phone');
    expect(cap.row.phone).toBe('9876543210');
    expect(cap.row.name).toBe('Asha');
    expect(cap.row.edition_id).toBe('e1');
    expect(cap.row.step_reached).toBe('name_entered');
  });

  it('always upserts so the database can start a new future lead after the supplied edition ends', async () => {
    const cap: any = { row: null, onConflict: null };
    (serviceClient as any).mockReturnValue(mockSupabase({ upsertCapture: cap }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', edition_id: 'e1', step_reached: 'phone_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(200);
    expect(cap.row).toEqual(expect.objectContaining({ edition_id: 'e1', phone: '9876543210' }));
  });

  it('returns 429 when Cloudflare rejects the subject rate limit', async () => {
    const cap: any = { row: null, onConflict: null };
    (serviceClient as any).mockReturnValue(mockSupabase({ upsertCapture: cap }));
    const limiter = {
      limit: vi.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false }),
    };
    const body = JSON.stringify({ phone: '9876543210', edition_id: 'e1', step_reached: 'phone_entered' });
    await handleLead(new Request('http://x', { method: 'POST', body }), env({ SUBJECT_RATE_LIMITER: limiter }));
    expect(cap.row).not.toBeNull();
    cap.row = null;
    const res2 = await handleLead(new Request('http://x', { method: 'POST', body }), env({ SUBJECT_RATE_LIMITER: limiter }));
    expect(res2.status).toBe(429);
    expect(cap.row).toBeNull();
  });
});
