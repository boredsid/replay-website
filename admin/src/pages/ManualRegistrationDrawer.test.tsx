import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import ManualRegistrationDrawer from './ManualRegistrationDrawer';

it('submits a manual registration with the selected edition', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [
      { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 }, pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 }, registration_status: 'upcoming', is_current: true, is_published: true },
    ] });
    return Promise.resolve({ ok: true, registration_id: 'r9' });
  });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await screen.findByRole('option', { name: /replay-3/i });
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
      { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 }, pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 }, registration_status: 'upcoming', is_current: true, is_published: true },
    ] });
    return Promise.resolve({ ok: true });
  });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/phone/i), '12');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  expect((fetchAdmin as any)).not.toHaveBeenCalledWith('/api/admin/registrations', expect.anything());
});
