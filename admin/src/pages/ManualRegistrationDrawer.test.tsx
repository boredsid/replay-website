import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { fetchAdmin: vi.fn(), showApiError: vi.fn(), ApiError: actual.ApiError };
});
import { fetchAdmin, ApiError } from '@/lib/api';
import ManualRegistrationDrawer from './ManualRegistrationDrawer';

it('submits a manual registration with the selected edition', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [
      { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 }, pricing: { oneshot: { day1: 700, day2: 700 }, campaign: 1200, adventurer_cap: 1000 }, registration_status: 'upcoming', is_current: true, is_published: true },
    ] });
    return Promise.resolve({ ok: true, registration_id: 'r9' });
  });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await screen.findByRole('option', { name: /replay-3/i });
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(700));
  await userEvent.type(screen.getByLabelText(/phone/i), '9876543210');
  await userEvent.type(screen.getByLabelText(/name/i), 'Asha');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/registrations', expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('"edition":"replay-3"'),
  })));
});

it('blocks submit when phone is too short', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [
      { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 }, pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 }, registration_status: 'upcoming', is_current: true, is_published: true },
    ] });
    return Promise.resolve({ ok: true });
  });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/phone/i), '12');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  expect((fetchAdmin as any)).not.toHaveBeenCalledWith('/api/admin/registrations', expect.anything());
});

const EDITION_FOR_PROMO = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'open', is_current: true, is_published: true,
};

it('applies a promo code, drops the amount, and records the redemption', async () => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION_FOR_PROMO] });
    if (path === '/api/admin/promo-codes/validate') {
      return Promise.resolve({ promo: { id: 'p1', code: 'EARLYBIRD', message: 'Early bird — 20% off.', discount: 140 } });
    }
    return Promise.resolve({ ok: true, registration_id: 'r9' });
  });

  const user = userEvent.setup();
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await screen.findByRole('option', { name: /replay-3/i });
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(700));

  await user.type(screen.getByLabelText(/phone/i), '9876543210');
  await user.type(screen.getByLabelText('Promo code'), 'earlybird');
  await user.click(screen.getByRole('button', { name: /^apply$/i }));

  expect(await screen.findByText('Early bird — 20% off.')).toBeInTheDocument();
  // The amount follows the code, but stays editable for a different settlement.
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(560));

  await user.click(screen.getByRole('button', { name: /add registration/i }));
  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/registrations', expect.anything()));
  const call = (fetchAdmin as any).mock.calls.find(([p]: [string]) => p === '/api/admin/registrations');
  expect(JSON.parse(call[1].body)).toMatchObject({ promo_code: 'EARLYBIRD', amount_paid: 560 });
});

it('explains a refused code and leaves the amount at full price', async () => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION_FOR_PROMO] });
    if (path === '/api/admin/promo-codes/validate') return Promise.reject(new ApiError(404, 'promo_already_used'));
    return Promise.resolve({ ok: true });
  });

  const user = userEvent.setup();
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await screen.findByRole('option', { name: /replay-3/i });
  await user.type(screen.getByLabelText('Promo code'), 'USEDCODE');
  await user.click(screen.getByRole('button', { name: /^apply$/i }));

  expect(await screen.findByText('This phone has already used that code.')).toBeInTheDocument();
  expect(screen.getByLabelText('Amount')).toHaveValue(700);
});

it('drops an applied code when the pass type changes', async () => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION_FOR_PROMO] });
    if (path === '/api/admin/promo-codes/validate') {
      return Promise.resolve({ promo: { id: 'p1', code: 'EARLYBIRD', message: 'Early bird — 20% off.', discount: 140 } });
    }
    return Promise.resolve({ ok: true });
  });

  const user = userEvent.setup();
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await screen.findByRole('option', { name: /replay-3/i });
  await user.type(screen.getByLabelText('Promo code'), 'EARLYBIRD');
  await user.click(screen.getByRole('button', { name: /^apply$/i }));
  await screen.findByText('Early bird — 20% off.');

  await user.selectOptions(screen.getByLabelText('Pass type'), 'campaign');

  // A discount priced against the 1-day pass says nothing about the 2-day one.
  expect(screen.queryByText('Early bird — 20% off.')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(1200));
});
