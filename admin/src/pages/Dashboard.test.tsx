import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Dashboard from './Dashboard';

it('renders spots and revenue', async () => {
  (fetchAdmin as any).mockResolvedValue({
    edition: { id: 'e1', slug: 'replay-3', name: 'REPLAY', registration_status: 'open' },
    spots_by_day: { day1: { capacity: 250, confirmed: 10, remaining: 240 }, day2: { capacity: 250, confirmed: 8, remaining: 242 } },
    totals: { confirmed: 18, pending: 2, cancelled: 1, revenue: 14400 },
    recent_registrations: [{
      id: 'r1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'], seats: 1,
      amount_paid: 700, payment_status: 'confirmed', created_at: '2026-08-01', users: { name: 'Asha' },
    }],
    recent_leads: [],
  });
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByText(/14,?400/)).toBeInTheDocument());
  expect(screen.getByText(/240/)).toBeInTheDocument();
  expect(screen.getByText('Asha')).toBeInTheDocument();
  expect(screen.queryByText('9876543210')).not.toBeInTheDocument();
});
