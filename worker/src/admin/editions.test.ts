import { describe, it, expect } from 'vitest';
import { handleEdCreate, handleEdPatch } from './editions';

const O = 'https://admin.replaycon.in';
const PRICING = { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 };
const CAP = { day1: 250, day2: 250 };

describe('handleEdCreate', () => {
  it('rejects an invalid slug', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'Bad Slug', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: PRICING, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects end_date before start_date', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'X', start_date: '2027-01-02', end_date: '2027-01-01', pricing: PRICING, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate slug', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e9' }, error: null }) }) }) }) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-3', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: PRICING, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(409);
  });

  it('creates an edition and writes an audit row', async () => {
    const audit: any = {};
    let inserted: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: (row: any) => { inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'e4', ...row }, error: null }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'REPLAY', start_date: '2027-01-01', end_date: '2027-01-02', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP, is_published: false }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(inserted.slug).toBe('replay-4');
    expect(inserted.registration_status).toBe('upcoming');
    expect(audit.row.action).toBe('edition.create');
  });

  it('rejects a negative capacity', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: PRICING, capacity_per_day: { day1: -5, day2: 250 } }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects a non-finite price', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: null }, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });
});

describe('handleEdPatch', () => {
  it('returns 404 when edition missing', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const req = new Request('https://x/api/admin/editions/eX', { method: 'PATCH', body: JSON.stringify({ registration_status: 'open' }) });
    const res = await handleEdPatch(req, {} as any, sb, 'eX', 'sid@x.com', O);
    expect(res.status).toBe(404);
  });

  it('flips registration_status and writes a diff', async () => {
    const audit: any = {};
    const before = { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP, registration_status: 'upcoming', is_current: true, is_published: true };
    const sb: any = {
      from: (t: string) => {
        if (t === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...before, registration_status: 'open' }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/editions/e3', { method: 'PATCH', body: JSON.stringify({ registration_status: 'open' }) });
    const res = await handleEdPatch(req, {} as any, sb, 'e3', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.diff.registration_status).toEqual({ old: 'upcoming', new: 'open' });
  });
});
