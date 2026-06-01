import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));

import { serviceClient } from './supabase';
import { getEditionById, getConfirmedSeatsByDay, dayLabel, getEditionBySlug, getCurrentEdition } from './editions';

describe('getEditionById', () => {
  it('returns the row when found', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'e1', slug: 'replay-3' }, error: null }),
          }),
        }),
      }),
    });
    const row = await getEditionById({} as any, 'e1');
    expect(row).toEqual({ id: 'e1', slug: 'replay-3' });
  });

  it('returns null when not found', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    });
    const row = await getEditionById({} as any, 'missing');
    expect(row).toBeNull();
  });
});

describe('getConfirmedSeatsByDay', () => {
  it('sums seats from confirmed rows, day1+day2 each counted', async () => {
    const rows = [
      { days: ['day1'], seats: 1 },
      { days: ['day1', 'day2'], seats: 1 },
      { days: ['day2'], seats: 2 },
      { days: ['day1', 'day2'], seats: 1 },
    ];
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              then: (cb: any) => cb({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    });
    const out = await getConfirmedSeatsByDay({} as any, 'e1');
    // day1: 1 + 1 + 1 = 3; day2: 1 + 2 + 1 = 4
    expect(out).toEqual({ day1: 3, day2: 4 });
  });

  it('returns zeros when no confirmed rows', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              then: (cb: any) => cb({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });
    const out = await getConfirmedSeatsByDay({} as any, 'e1');
    expect(out).toEqual({ day1: 0, day2: 0 });
  });
});

describe('dayLabel', () => {
  it('joins single and double days into human-readable string', () => {
    expect(dayLabel(['day1'])).toBe('Saturday');
    expect(dayLabel(['day2'])).toBe('Sunday');
    expect(dayLabel(['day1', 'day2'])).toBe('Saturday + Sunday');
  });
});

describe('getEditionBySlug', () => {
  it('returns the row matched by slug', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', slug: 'replay-3' }, error: null }) }) }) }),
    });
    const row = await getEditionBySlug({ SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any, 'replay-3');
    expect(row?.id).toBe('e1');
  });
});

describe('getCurrentEdition', () => {
  it('returns the is_current row', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', is_current: true }, error: null }) }) }) }),
    });
    const row = await getCurrentEdition({ SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any);
    expect(row?.id).toBe('e1');
  });
});
