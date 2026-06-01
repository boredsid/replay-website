import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import RegistrationsList from './RegistrationsList';

it('renders registration rows (mobile cards + desktop table)', async () => {
  (fetchAdmin as any).mockResolvedValue({
    edition: { id: 'e1', slug: 'replay-3' },
    registrations: [{ id: 'r1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 800, payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Asha' } }],
  });
  render(<MemoryRouter><RegistrationsList /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText('Asha').length).toBeGreaterThan(0));
  expect(screen.getAllByText('9876543210').length).toBeGreaterThan(0);
});
