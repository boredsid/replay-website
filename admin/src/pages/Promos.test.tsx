import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Promos, { promoState, discountLabel } from './Promos';
import type { PromoCodeRow } from '@/lib/types';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'open', is_current: true, is_published: true,
};

const NOW = new Date('2026-09-05T12:00:00Z');

function promo(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: 'p1', edition_id: 'e3', code: 'EARLYBIRD',
    applied_message: 'Early bird unlocked — 20% off.',
    internal_note: null,
    discount_type: 'percent', discount_value: 20, max_discount: null,
    scope: 'booking', pass_type: null,
    starts_at: null, ends_at: null,
    max_redemptions: null, max_per_phone: 1, min_quantity: 1, is_active: true,
    redemption_count: 0,
    created_at: '2026-08-31T00:00:00.000Z', updated_at: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('promoState', () => {
  it('is live when active, inside its window, and under its cap', () => {
    expect(promoState(promo(), NOW)).toBe('live');
  });
  it('is inactive when switched off, whatever else is true', () => {
    expect(promoState(promo({ is_active: false }), NOW)).toBe('draft');
  });
  it('is scheduled before the window opens and expired after it closes', () => {
    expect(promoState(promo({ starts_at: '2026-09-10T00:00:00Z' }), NOW)).toBe('scheduled');
    expect(promoState(promo({ ends_at: '2026-09-01T00:00:00Z' }), NOW)).toBe('expired');
  });
  it('is exhausted once the redemption cap is reached', () => {
    expect(promoState(promo({ max_redemptions: 50, redemption_count: 50 }), NOW)).toBe('exhausted');
    expect(promoState(promo({ max_redemptions: 50, redemption_count: 49 }), NOW)).toBe('live');
  });
  it('reports exhausted ahead of the window, since the cap is the harder stop', () => {
    const done = promo({ max_redemptions: 10, redemption_count: 10, starts_at: '2026-09-10T00:00:00Z' });
    expect(promoState(done, NOW)).toBe('exhausted');
  });
});

describe('discountLabel', () => {
  it('describes a percentage over the booking', () => {
    expect(discountLabel(promo())).toBe('20% off — the booking');
  });
  it('names the cap and the first-ticket scope', () => {
    expect(discountLabel(promo({ max_discount: 500, scope: 'first_ticket' })))
      .toBe('20% off (max ₹500) — first ticket');
  });
  it('names the ticket floor only when the code is a bulk discount', () => {
    expect(discountLabel(promo({ min_quantity: 5 }))).toBe('20% off — the booking · 5+ tickets');
  });
  it('describes a flat amount', () => {
    expect(discountLabel(promo({ discount_type: 'flat', discount_value: 100 })))
      .toBe('₹100 off — the booking');
  });
});

describe('Promos list', () => {
  beforeEach(() => {
    (fetchAdmin as any).mockReset();
    (fetchAdmin as any).mockImplementation((path: string) => {
      if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION] });
      if (path.startsWith('/api/admin/promo-codes')) {
        return Promise.resolve({
          promo_codes: [
            promo({ id: 'p1', code: 'EARLYBIRD', max_redemptions: 100, redemption_count: 7 }),
            promo({ id: 'p2', code: 'WEEKEND', is_active: false, pass_type: 'campaign', applied_message: 'Weekend deal applied.' }),
          ],
        });
      }
      return Promise.resolve({ ok: true });
    });
  });

  it('lists codes for the current edition with their usage', async () => {
    render(<MemoryRouter><Promos /></MemoryRouter>);

    expect(await screen.findByText('EARLYBIRD')).toBeInTheDocument();
    expect(screen.getByText('7 / 100 used')).toBeInTheDocument();
    expect(screen.getByText('WEEKEND')).toBeInTheDocument();
    expect(screen.getByText('2-day only')).toBeInTheDocument();
    expect(screen.getByText('Early bird unlocked — 20% off.', { selector: 'p' })).toBeInTheDocument();
  });

  it('filters to the codes an attendee could use right now', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Promos /></MemoryRouter>);

    await screen.findByText('EARLYBIRD');
    await user.selectOptions(screen.getByLabelText('State'), 'live');

    expect(screen.getByText('EARLYBIRD')).toBeInTheDocument();
    expect(screen.queryByText('WEEKEND')).not.toBeInTheDocument();
  });

  it('scopes the request to the selected edition', async () => {
    render(<MemoryRouter><Promos /></MemoryRouter>);
    await screen.findByText('EARLYBIRD');
    expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/promo-codes?edition_id=e3');
  });
});
