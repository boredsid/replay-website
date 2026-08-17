import { describe, expect, it, vi, beforeEach } from 'vitest';

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
            in: async () => ({ data: rows, error: null }),
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
            in: async () => ({ data: [], error: null }),
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
    const row = await getEditionBySlug({} as any, 'replay-3');
    expect(row?.id).toBe('e1');
  });

  it('returns null when not found', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    });
    expect(await getEditionBySlug({} as any, 'nope')).toBeNull();
  });
});

describe('getCurrentEdition', () => {
  const maybeSingleMock = vi.fn();

  beforeEach(() => {
    maybeSingleMock.mockReset();
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: maybeSingleMock }),
          }),
        }),
      }),
    });
  });

  it('returns the explicitly current published edition', async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: 'e3', slug: 'replay-3', start_date: '2026-09-12' }, error: null });
    const ed = await getCurrentEdition({} as any);
    expect(ed?.slug).toBe('replay-3');
  });

  it('returns null when no published edition', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const ed = await getCurrentEdition({} as any);
    expect(ed).toBeNull();
  });
});
