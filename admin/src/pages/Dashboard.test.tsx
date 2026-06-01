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
    recent_registrations: [], recent_leads: [],
  });
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByText(/14,?400/)).toBeInTheDocument());
  expect(screen.getByText(/240/)).toBeInTheDocument();
});
