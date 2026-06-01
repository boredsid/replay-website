import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
}));
import { handleLeadsList } from './leads';

describe('handleLeadsList', () => {
  it('returns leads for the edition', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'l1' }], error: null }) }) }) }) };
    const req = new Request('https://api.x/api/admin/leads');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.leads).toHaveLength(1);
  });
});
