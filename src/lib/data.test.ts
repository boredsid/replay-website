import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} as any }));

import { supabase } from './supabase';
import { getCurrentEdition, getSponsors, getScheduleItems } from './data';

function mockChain(table: string, result: any) {
  const order = vi.fn().mockReturnThis();
  const limit = vi.fn().mockReturnThis();
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

describe('getCurrentEdition', () => {
  it('returns the row when is_current=true and is_published=true', async () => {
    const row = { id: 'e1', slug: 'replay-3', is_current: true, is_published: true };
    const { from } = mockChain('editions', { data: row, error: null });
    Object.assign(supabase, { from });
    const out = await getCurrentEdition();
    expect(out).toEqual(row);
  });

  it('returns null when no row matches', async () => {
    const { from } = mockChain('editions', { data: null, error: null });
    Object.assign(supabase, { from });
    const out = await getCurrentEdition();
    expect(out).toBeNull();
  });
});

describe('getSponsors', () => {
  it('returns ordered sponsors for the edition', async () => {
    const rows = [{ id: 's1', display_order: 0 }, { id: 's2', display_order: 1 }];
    const { from } = mockChain('sponsors', { data: rows, error: null });
    Object.assign(supabase, { from });
    const out = await getSponsors('e1');
    expect(out).toEqual(rows);
  });

  it('returns [] when no sponsors', async () => {
    const { from } = mockChain('sponsors', { data: [], error: null });
    Object.assign(supabase, { from });
    const out = await getSponsors('e1');
    expect(out).toEqual([]);
  });
});

describe('getScheduleItems', () => {
  it('returns ordered items', async () => {
    const rows = [{ id: 'i1', day: '2026-09-12', start_time: '10:00' }, { id: 'i2', day: '2026-09-12', start_time: '11:00' }];
    const { from } = mockChain('schedule_items', { data: rows, error: null });
    Object.assign(supabase, { from });
    const out = await getScheduleItems('e1');
    expect(out).toEqual(rows);
  });
});
