import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import ManualRegistrationDrawer from './ManualRegistrationDrawer';

it('submits a manual registration', async () => {
  (fetchAdmin as any).mockResolvedValue({ ok: true, registration_id: 'r9' });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/phone/i), '9876543210');
  await userEvent.type(screen.getByLabelText(/name/i), 'Asha');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/registrations', expect.objectContaining({ method: 'POST' })));
});

it('blocks submit when phone is too short', async () => {
  (fetchAdmin as any).mockResolvedValue({ ok: true });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/phone/i), '12');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  expect((fetchAdmin as any)).not.toHaveBeenCalled();
});
