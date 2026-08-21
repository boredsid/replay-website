import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} as any }));

import { supabase } from './supabase';
import { getCurrentEdition, getSponsors, getScheduleItems, publicDateRange } from './data';

function mockChain(result: any) {
  const order = vi.fn().mockReturnThis();
  const limit = vi.fn().mockResolvedValue(result);
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(function (this: any) { return this; });
  const select = vi.fn(function (this: any) { return this; });
  const thenable = { data: result.data, error: result.error };
  const builder: any = { select, eq, order, limit, maybeSingle, single, then: (cb: any) => cb(thenable) };
  return { from: vi.fn().mockReturnValue(builder), builder };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('publicDateRange', () => {
  it('formats a same-month range without locale artifacts', () => {
    expect(publicDateRange('2026-09-12', '2026-09-13')).toBe('Sep 12–13, 2026');
  });

  it('formats cross-month and cross-year ranges', () => {
    expect(publicDateRange('2026-09-30', '2026-10-01')).toBe('Sep 30–Oct 1, 2026');
    expect(publicDateRange('2026-12-31', '2027-01-01')).toBe('Dec 31, 2026–Jan 1, 2027');
  });
});

describe('getCurrentEdition', () => {
  it('returns the explicitly current published edition', async () => {
    const row = {
      id: 'e3', slug: 'replay-3', is_current: true, is_published: true, start_date: '2026-09-12',
      pricing: { oneshot: { day1: 700, day2: 700 }, campaign: 1200, adventurer_cap: 1000 },
    };
    const { from, builder } = mockChain({ data: row, error: null });
    Object.assign(supabase, { from });
    const out = await getCurrentEdition();
    expect(out).toEqual({
      ...row,
      pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
      partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
    });
    expect(builder.eq).toHaveBeenCalledWith('is_current', true);
    expect(builder.eq).toHaveBeenCalledWith('is_published', true);
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it('returns null when no published edition matches', async () => {
    const { from } = mockChain({ data: null, error: null });
    Object.assign(supabase, { from });
    const out = await getCurrentEdition();
    expect(out).toBeNull();
  });
});

describe('getSponsors', () => {
  it('returns ordered sponsors for the edition', async () => {
    const rows = [{ id: 's1', display_order: 0 }, { id: 's2', display_order: 1 }];
    const { from } = mockChain({ data: rows, error: null });
    Object.assign(supabase, { from });
    const out = await getSponsors('e1');
    expect(out).toEqual(rows);
  });

  it('returns [] when no sponsors', async () => {
    const { from } = mockChain({ data: [], error: null });
    Object.assign(supabase, { from });
    const out = await getSponsors('e1');
    expect(out).toEqual([]);
  });
});

describe('getScheduleItems', () => {
  it('returns ordered items', async () => {
    const rows = [
      { id: 'i1', edition_id: 'e1', day: '2026-09-12', title: 'Workshop', kind: 'workshop', start_time: '10:00', end_time: '11:00' },
      { id: 'i2', edition_id: 'e1', day: '2026-09-12', title: 'Quiz', kind: 'quiz', start_time: '11:00', end_time: '12:00', section: 'programme', public_status: 'published' },
    ];
    const { from } = mockChain({ data: rows, error: null });
    Object.assign(supabase, { from });
    const out = await getScheduleItems('e1');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ section: 'programme', public_status: 'published', is_all_day: false, signup_mode: 'none', display_order: 0 });
    expect(out[1]).toMatchObject({ section: 'programme', public_status: 'published' });
  });
});
