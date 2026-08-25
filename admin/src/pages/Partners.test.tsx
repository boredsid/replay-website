import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Partners from './Partners';

it('lists partner purchases with status and total', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [{ id: 'e1', slug: 'replay-3', name: 'REPLAY', is_current: true }] });
    return Promise.resolve({ partners: [{
      id: 'p1', edition_id: 'e1', organization_name: 'Tabletop Club', contact_name: 'Asha', phone: '9876543210', email: 'asha@example.com',
      package_key: 'standard_booth', kind: 'booth', days: ['day1', 'day2'], total_amount: 9440, payment_status: 'pending',
      stage: 'prospective', invite_url: null, payment_claimed_at: null,
    }, {
      id: 'p2', edition_id: 'e1', organization_name: 'Meeple Mart', contact_name: null, phone: null, email: null,
      package_key: 'zone_sponsor', kind: 'sponsorship', days: ['day1', 'day2'], total_amount: 17700, payment_status: 'pending',
      stage: 'lead', invite_url: 'https://replaycon.in/partner/?t=a1b2c3d4e5f6a7b8c9d0e1f2', payment_claimed_at: null,
    }] });
  });
  render(<MemoryRouter><Partners /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText('Tabletop Club').length).toBeGreaterThan(0));
  expect(screen.getAllByText('Standard booth').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Prospective').length).toBeGreaterThan(0);
});

it('offers the link to copy for a lead, and nothing to copy for a partner without one', async () => {
  render(<MemoryRouter><Partners /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText('Meeple Mart').length).toBeGreaterThan(0));
  expect(screen.getAllByText('Lead').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1);
});

