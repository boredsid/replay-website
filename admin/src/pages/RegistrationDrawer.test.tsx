import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import RegistrationDrawer from './RegistrationDrawer';

it('confirms a pending registration', async () => {
  (fetchAdmin as any).mockImplementation(async (_path: string, init?: any) => {
    if (!init) return { registration: { id: 'r1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'], amount_paid: 800, payment_status: 'pending', users: { name: 'Asha', email: 'a@x.com' } } };
    return { ok: true };
  });
  render(<MemoryRouter initialEntries={["/registrations/r1"]}><Routes><Route path="/registrations/:id" element={<RegistrationDrawer />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/registrations/r1', expect.objectContaining({ method: 'PATCH' })));
});
