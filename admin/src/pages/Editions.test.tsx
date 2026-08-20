import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Editions from './Editions';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'upcoming', is_current: true, is_published: true,
};

beforeEach(() => (fetchAdmin as any).mockReset());

it('lists editions', async () => {
  (fetchAdmin as any).mockResolvedValue({ editions: [EDITION] });
  render(<MemoryRouter><Editions /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('replay-3')).toBeInTheDocument());
  expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/editions');
});
