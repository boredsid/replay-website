import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import RegistrationsList from './RegistrationsList';

it('renders registration rows (mobile cards + desktop table)', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({
      editions: [{ id: 'e1', slug: 'replay-3', name: 'REPLAY', is_current: true }],
    });
    return Promise.resolve({
      registrations: [{ id: 'r1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 800, payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Asha' } }],
    });
  });
  render(<MemoryRouter><RegistrationsList /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText('Asha').length).toBeGreaterThan(0));
  expect(screen.getAllByText('9876543210').length).toBeGreaterThan(0);
});

it('marks why a row costs what it does, and leaves full-price rows unmarked', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({
      editions: [{ id: 'e1', slug: 'replay-3', name: 'REPLAY', is_current: true }],
    });
    return Promise.resolve({
      registrations: [
        { id: 'r1', user_phone: '1', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 0, discount_applied: 800, guild_tier_at_purchase: 'guildmaster', payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Asha' } },
        { id: 'r2', user_phone: '2', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 600, promo_code: 'EARLY', promo_discount: 200, payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Bhavna' } },
        { id: 'r3', user_phone: '3', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 0, source: { manual: true, by: 'desk@x.in' }, payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Chandra' } },
        { id: 'r4', user_phone: '4', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 800, payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Divya' } },
      ],
    });
  });
  render(<MemoryRouter><RegistrationsList /></MemoryRouter>);
  // Two viewports render every row, so each marker appears twice.
  await waitFor(() => expect(screen.getAllByText('Guild')).toHaveLength(2));
  expect(screen.getAllByText('Promo')).toHaveLength(2);
  expect(screen.getAllByText('Desk')).toHaveLength(2);
  expect(screen.queryByText('Adjusted')).toBeNull();
});
