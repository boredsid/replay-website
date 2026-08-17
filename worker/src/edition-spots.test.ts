import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./editions', () => ({
  getEditionById: vi.fn(),
  getReservedSeatsByDay: vi.fn(),
}));

import { getEditionById, getReservedSeatsByDay } from './editions';
import { handleEditionSpots } from './edition-spots';

function env() { return {} as any; }

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleEditionSpots', () => {
  it('returns 404 when edition not found', async () => {
    (getEditionById as any).mockResolvedValue(null);
    const res = await handleEditionSpots('missing', env());
    expect(res.status).toBe(404);
  });

  it('zero registrations => remaining equals capacity', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getReservedSeatsByDay as any).mockResolvedValue({ day1: 0, day2: 0 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body).toEqual({
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
  });

  it('mixed: day1 sold out, day2 partial', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getReservedSeatsByDay as any).mockResolvedValue({ day1: 250, day2: 100 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body.day1).toEqual({ capacity: 250, remaining: 0, sold_out: true });
    expect(body.day2).toEqual({ capacity: 250, remaining: 150, sold_out: false });
    expect(body.both_sold_out).toBe(false);
  });

  it('both sold out', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getReservedSeatsByDay as any).mockResolvedValue({ day1: 250, day2: 250 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body.both_sold_out).toBe(true);
  });

  it('clamps remaining to 0 when seats exceed capacity (overshoot safety)', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getReservedSeatsByDay as any).mockResolvedValue({ day1: 280, day2: 0 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body.day1.remaining).toBe(0);
    expect(body.day1.sold_out).toBe(true);
  });
});
