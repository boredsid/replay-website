import { describe, it, expect } from 'vitest';
import { handleEdCreate, handleEdPatch } from './editions';

const O = 'https://admin.replaycon.in';
const PRICING = { oneshot: 800, campaign: 1400, adventurer_cap: 1000 };
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
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-3', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', daily_start_time: '10:00', daily_end_time: '19:00', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP }) });
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
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({
      slug: 'replay-4', name: 'REPLAY', start_date: '2027-01-01', end_date: '2027-01-02',
      daily_start_time: '10:00', daily_end_time: '19:00', venue: 'The Foundry',
      venue_address: '  12 Residency Road, Bengaluru  ',
      google_maps_url: 'https://maps.app.goo.gl/replay',
      entrance_details: '  Use the north gate.  ',
      check_in_location: 'Lobby desk',
      nearest_metro_name: 'MG Road', nearest_metro_distance: '700 m',
      nearest_bus_stop_name: 'Mayo Hall', nearest_bus_stop_distance: '250 m',
      parking_availability: 'Limited basement parking', parking_charges: '₹50 per hour',
      food_details: 'Food court on level 2', water_details: 'Refill point at the library desk',
      game_library_process: 'Borrow one game at a time.', help_on_the_day: 'Ask at the help desk.',
      pricing: PRICING, capacity_per_day: CAP, is_published: false,
    }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(inserted.slug).toBe('replay-4');
    expect(inserted.registration_status).toBe('upcoming');
    expect(inserted.venue_address).toBe('12 Residency Road, Bengaluru');
    expect(inserted.google_maps_url).toBe('https://maps.app.goo.gl/replay');
    expect(inserted.entrance_details).toBe('Use the north gate.');
    expect(inserted.game_library_process).toBe('Borrow one game at a time.');
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
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: { oneshot: 800, campaign: 1400, adventurer_cap: null }, capacity_per_day: CAP }) });
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
    const before = { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', daily_start_time: '10:00', daily_end_time: '19:00', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP, registration_status: 'upcoming', is_current: true, is_published: true };
    const sb: any = {
      from: (t: string) => {
        if (t === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: (patch: any) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...before, ...patch }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/editions/e3', { method: 'PATCH', body: JSON.stringify({ registration_status: 'open', entrance_details: '  North gate  ', parking_charges: '' }) });
    const res = await handleEdPatch(req, {} as any, sb, 'e3', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.diff.registration_status).toEqual({ old: 'upcoming', new: 'open' });
    expect(audit.row.diff.entrance_details).toEqual({ old: undefined, new: 'North gate' });
    expect(audit.row.diff.parking_charges).toEqual({ old: undefined, new: null });
  });

  it('rejects a non-HTTPS Google Maps pin', async () => {
    const before = { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', daily_start_time: '10:00', daily_end_time: '19:00', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP, registration_status: 'upcoming', is_current: true, is_published: true };
    const sb: any = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }) }),
    };
    const req = new Request('https://x/api/admin/editions/e3', { method: 'PATCH', body: JSON.stringify({ google_maps_url: 'javascript:alert(1)' }) });
    const res = await handleEdPatch(req, {} as any, sb, 'e3', 'sid@x.com', O);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_google_maps_url' });
  });
});
