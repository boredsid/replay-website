import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
}));
import { handleLeadsList } from './leads';

describe('handleLeadsList', () => {
  function mockSupabase({
    leads = [],
    leadsError = null,
  }: {
    leads?: Array<Record<string, unknown>>;
    leadsError?: { message: string } | null;
  }) {
    const filters: Array<[string, ...unknown[]]> = [];
    const builder: any = {
      is: (column: string, value: unknown) => { filters.push(['is', column, value]); return builder; },
      not: (column: string, operator: string, value: unknown) => { filters.push(['not', column, operator, value]); return builder; },
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; },
      order: async () => ({ data: leads, error: leadsError }),
    };
    return {
      filters,
      from: () => ({ select: () => builder }),
    } as any;
  }

  it('defaults to open leads across all editions', async () => {
    const sb = mockSupabase({
      leads: [
        { id: 'open', phone: '9876543210', converted_at: null },
      ],
    });
    const req = new Request('https://api.x/api/admin/leads');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.leads).toEqual([{ id: 'open', phone: '9876543210', converted_at: null }]);
    expect(sb.filters).toContainEqual(['is', 'converted_at', null]);
  });

  it('filters by edition and converted state', async () => {
    const sb = mockSupabase({ leads: [{ id: 'converted' }] });
    const req = new Request('https://api.x/api/admin/leads?edition=replay-3&conversion=converted');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    expect(sb.filters).toContainEqual(['eq', 'edition_id', 'e1']);
    expect(sb.filters).toContainEqual(['not', 'converted_at', 'is', null]);
  });

  it('can show only untagged leads', async () => {
    const sb = mockSupabase({});
    const req = new Request('https://api.x/api/admin/leads?edition=untagged&conversion=all');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    expect(sb.filters).toEqual([['is', 'edition_id', null]]);
  });

  it('rejects an invalid conversion filter', async () => {
    const sb = mockSupabase({});
    const req = new Request('https://api.x/api/admin/leads?conversion=maybe');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(400);
  });

  it('returns query_failed when the leads query fails', async () => {
    const sb = mockSupabase({ leadsError: { message: 'boom' } });
    const req = new Request('https://api.x/api/admin/leads?conversion=all');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'query_failed' });
  });
});
