import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
}));
import { handleLeadsList } from './leads';

describe('handleLeadsList', () => {
  function mockSupabase({
    leads = [],
    registrations = [],
    leadsError = null,
    registrationsError = null,
  }: {
    leads?: Array<Record<string, unknown>>;
    registrations?: Array<Record<string, unknown>>;
    leadsError?: { message: string } | null;
    registrationsError?: { message: string } | null;
  }) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => table === 'leads'
            ? { order: async () => ({ data: leads, error: leadsError }) }
            : Promise.resolve({ data: registrations, error: registrationsError }),
        }),
      }),
    } as any;
  }

  it('returns only leads without a registration for the edition', async () => {
    const sb = mockSupabase({
      leads: [
        { id: 'unregistered', phone: '9876543210' },
        { id: 'registered', phone: '9123456780' },
      ],
      registrations: [{ user_phone: '9123456780' }],
    });
    const req = new Request('https://api.x/api/admin/leads');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.leads).toEqual([{ id: 'unregistered', phone: '9876543210' }]);
  });

  it('returns query_failed when the registrations query fails', async () => {
    const sb = mockSupabase({ registrationsError: { message: 'boom' } });
    const req = new Request('https://api.x/api/admin/leads');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'query_failed' });
  });
});
