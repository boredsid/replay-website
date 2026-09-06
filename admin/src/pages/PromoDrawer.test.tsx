import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { fetchAdmin: vi.fn(), showApiError: vi.fn(), ApiError: actual.ApiError };
});
import { fetchAdmin, ApiError } from '@/lib/api';
import PromoDrawer from './PromoDrawer';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'open', is_current: true, is_published: true,
};

const EXISTING = {
  id: 'p1', edition_id: 'e3', code: 'EARLYBIRD',
  applied_message: 'Early bird unlocked — 20% off your whole order.',
  internal_note: 'Instagram launch post',
  discount_type: 'percent', discount_value: 20, max_discount: 500,
  scope: 'booking', pass_type: null,
  starts_at: '2026-09-01T04:30:00.000Z', ends_at: null,
  max_redemptions: 100, max_per_phone: 1, min_quantity: 5, is_active: true,
  redemption_count: 7,
  created_at: '2026-08-31T00:00:00.000Z', updated_at: '2026-08-31T00:00:00.000Z',
};

function mockApi(overrides: (path: string, init?: RequestInit) => unknown = () => undefined) {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string, init?: RequestInit) => {
    const override = overrides(path, init);
    if (override !== undefined) return override;
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION] });
    if (path === '/api/admin/promo-codes/p1' && !init) return Promise.resolve({ promo_code: EXISTING });
    return Promise.resolve({ ok: true });
  });
}

function renderNew() {
  render(
    <MemoryRouter initialEntries={['/promos/new?edition_id=e3']}>
      <Routes>
        <Route path="/promos/new" element={<PromoDrawer />} />
        <Route path="/promos" element={<div>Promo list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderExisting() {
  render(
    <MemoryRouter initialEntries={['/promos/p1']}>
      <Routes>
        <Route path="/promos/:id" element={<PromoDrawer />} />
        <Route path="/promos" element={<div>Promo list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { mockApi(); });

describe('PromoDrawer', () => {
  it('creates a percentage code with its applied message and limits', async () => {
    const user = userEvent.setup();
    renderNew();

    await screen.findByRole('heading', { name: 'New promo code' });
    await user.type(screen.getByLabelText('Code'), 'earlybird');
    await user.type(screen.getByLabelText('Applied message'), 'Early bird unlocked — 20% off your whole order.');
    await user.type(screen.getByLabelText('Discount value'), '20');
    await user.type(screen.getByLabelText('Maximum discount'), '500');
    await user.type(screen.getByLabelText('Total uses'), '100');
    await user.type(screen.getByLabelText('Starts at'), '2026-09-01T10:00');
    await user.click(screen.getByRole('button', { name: 'Create promo code' }));

    await waitFor(() =>
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/promo-codes', expect.objectContaining({ method: 'POST' })),
    );
    const call = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path === '/api/admin/promo-codes');
    expect(JSON.parse(call[1].body)).toMatchObject({
      edition_id: 'e3',
      code: 'EARLYBIRD', // uppercased for the attendee's convenience
      applied_message: 'Early bird unlocked — 20% off your whole order.',
      discount_type: 'percent',
      discount_value: 20,
      max_discount: 500,
      scope: 'booking',
      pass_type: null,
      starts_at: '2026-09-01T04:30:00.000Z', // IST in, UTC out
      max_redemptions: 100,
      max_per_phone: 1,
      min_quantity: 1, // no floor unless the organiser sets one
      is_active: true,
    });
    expect(await screen.findByText('Promo list')).toBeInTheDocument();
  });

  it('hides and clears the cap when the code becomes a flat amount', async () => {
    const user = userEvent.setup();
    renderNew();

    await screen.findByRole('heading', { name: 'New promo code' });
    await user.type(screen.getByLabelText('Maximum discount'), '500');
    await user.selectOptions(screen.getByLabelText('Discount type'), 'flat');

    // A flat code is its own ceiling; the database rejects the combination.
    expect(screen.queryByLabelText('Maximum discount')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount (₹)')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Code'), 'FLAT100');
    await user.type(screen.getByLabelText('Applied message'), '₹100 off, with our thanks.');
    await user.type(screen.getByLabelText('Discount value'), '100');
    await user.click(screen.getByRole('button', { name: 'Create promo code' }));

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/promo-codes', expect.anything()));
    const call = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path === '/api/admin/promo-codes');
    expect(JSON.parse(call[1].body)).toMatchObject({ discount_type: 'flat', discount_value: 100, max_discount: null });
  });

  it('sends a bulk floor so the code only applies to a group booking', async () => {
    const user = userEvent.setup();
    renderNew();

    await screen.findByRole('heading', { name: 'New promo code' });
    await user.type(screen.getByLabelText('Code'), 'GROUP5');
    await user.type(screen.getByLabelText('Applied message'), 'Group rate unlocked — 20% off.');
    await user.type(screen.getByLabelText('Discount value'), '20');
    await user.clear(screen.getByLabelText('Minimum tickets'));
    await user.type(screen.getByLabelText('Minimum tickets'), '5');
    await user.click(screen.getByRole('button', { name: 'Create promo code' }));

    await waitFor(() =>
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/promo-codes', expect.objectContaining({ method: 'POST' })),
    );
    const call = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path === '/api/admin/promo-codes');
    expect(JSON.parse(call[1].body)).toMatchObject({ code: 'GROUP5', min_quantity: 5 });
  });

  it('refuses an empty minimum before calling the API', async () => {
    const user = userEvent.setup();
    renderNew();

    await screen.findByRole('heading', { name: 'New promo code' });
    await user.type(screen.getByLabelText('Code'), 'GROUP5');
    await user.type(screen.getByLabelText('Applied message'), 'Group rate unlocked.');
    await user.type(screen.getByLabelText('Discount value'), '20');
    await user.clear(screen.getByLabelText('Minimum tickets'));
    await user.click(screen.getByRole('button', { name: 'Create promo code' }));

    expect(fetchAdmin).not.toHaveBeenCalledWith('/api/admin/promo-codes', expect.anything());
  });

  it('refuses a percentage above 100 before calling the API', async () => {
    const user = userEvent.setup();
    renderNew();

    await screen.findByRole('heading', { name: 'New promo code' });
    await user.type(screen.getByLabelText('Code'), 'TOOBIG');
    await user.type(screen.getByLabelText('Applied message'), 'Everything is free.');
    await user.type(screen.getByLabelText('Discount value'), '150');
    await user.click(screen.getByRole('button', { name: 'Create promo code' }));

    await waitFor(() =>
      expect((fetchAdmin as any).mock.calls.some(([path]: [string]) => path === '/api/admin/promo-codes')).toBe(false),
    );
  });

  it('loads an existing code, shows its redemptions, and blocks deleting it', async () => {
    renderExisting();

    await screen.findByRole('heading', { name: 'Edit EARLYBIRD' });
    expect(screen.getByLabelText('Code')).toHaveValue('EARLYBIRD');
    expect(screen.getByLabelText('Applied message')).toHaveValue('Early bird unlocked — 20% off your whole order.');
    expect(screen.getByLabelText('Maximum discount')).toHaveValue(500);
    expect(screen.getByLabelText('Starts at')).toHaveValue('2026-09-01T10:00'); // back to IST
    expect(screen.getByLabelText('Minimum tickets')).toHaveValue(5);
    expect(screen.getByText(/7/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete promo code' })).toBeDisabled();
  });

  it('sends the edit as a PATCH that preserves the code identity', async () => {
    const user = userEvent.setup();
    renderExisting();

    await screen.findByRole('heading', { name: 'Edit EARLYBIRD' });
    await user.click(screen.getByLabelText('Active')); // retire it
    await user.click(screen.getByRole('button', { name: 'Save promo code' }));

    await waitFor(() =>
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/promo-codes/p1', expect.objectContaining({ method: 'PATCH' })),
    );
    const call = (fetchAdmin as any).mock.calls.find(
      ([path, init]: [string, RequestInit?]) => path === '/api/admin/promo-codes/p1' && init?.method === 'PATCH',
    );
    expect(JSON.parse(call[1].body)).toMatchObject({ code: 'EARLYBIRD', is_active: false });
  });

  it('turns a duplicate-code refusal into copy that names the fix', async () => {
    const user = userEvent.setup();
    mockApi((path, init) =>
      path === '/api/admin/promo-codes' && init?.method === 'POST'
        ? Promise.reject(new ApiError(409, 'promo_code_exists'))
        : undefined,
    );
    const { toast } = await import('sonner');
    const errorToast = vi.spyOn(toast, 'error');

    renderNew();
    await screen.findByRole('heading', { name: 'New promo code' });
    await user.type(screen.getByLabelText('Code'), 'EARLYBIRD');
    await user.type(screen.getByLabelText('Applied message'), 'Twenty percent off.');
    await user.type(screen.getByLabelText('Discount value'), '20');
    await user.click(screen.getByRole('button', { name: 'Create promo code' }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('That code already exists for this edition. Pick a different word.'),
    );
  });
});
