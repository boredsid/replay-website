import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', name: 'REPLAY', registration_status: 'open', capacity_per_day: { day1: 250, day2: 250 } })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', name: 'REPLAY', registration_status: 'open', capacity_per_day: { day1: 250, day2: 250 } })),
  getReservedSeatsByDay: vi.fn(async () => ({ day1: 10, day2: 8 })),
}));
import { handleDashboard } from './dashboard';

const O = 'https://admin.replaycon.in';

describe('handleDashboard', () => {
  it('returns edition, spots, totals and recents', async () => {
    // registrations is queried two ways:
    //  (a) totals:  .select(...).eq(editionId)            -> awaited directly
    //  (b) recent:  .select(...).eq(editionId).order().limit()
    // leads:        .select('*').eq(editionId).order().limit()
    const regEq = () => {
      const builder: any = {
        order: () => ({ limit: async () => ({ data: [{ id: 'r1', payment_status: 'confirmed', users: { name: 'Asha' } }], error: null }) }),
        then: (resolve: any) => resolve({ data: [{ payment_status: 'confirmed', amount_paid: 800 }], error: null }),
      };
      return builder;
    };
    const sb: any = {
      from: (table: string) => ({
        select: () => ({
          eq: () => {
            if (table === 'leads') return { order: () => ({ limit: async () => ({ data: [{ id: 'l1' }], error: null }) }) };
            return regEq();
          },
        }),
      }),
    };
    const req = new Request('https://api.x/api/admin/dashboard');
    const res = await handleDashboard(req, {} as any, sb, O);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.spots_by_day.day1.remaining).toBe(240);
    expect(body.totals.revenue).toBe(800);
    expect(body.recent_registrations[0].users.name).toBe('Asha');
  });
});
