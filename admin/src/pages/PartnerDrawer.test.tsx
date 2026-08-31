import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import PartnerDrawer from './PartnerDrawer';

const edition = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', is_current: true,
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
};

beforeEach(() => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => path === '/api/admin/editions'
    ? Promise.resolve({ editions: [edition] })
    : Promise.resolve({ ok: true }));
});

it('adds a partner with the package pricing snapshot', async () => {
  render(<MemoryRouter initialEntries={['/partners/new?edition_id=e1']}><Routes><Route path="/partners/new" element={<PartnerDrawer />} /><Route path="/partners" element={<div>Partners list</div>} /></Routes></MemoryRouter>);
  await userEvent.type(await screen.findByLabelText('Organisation name'), 'Tabletop Club');
  await userEvent.type(screen.getByLabelText('Primary contact'), 'Asha');
  await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
  await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com');
  await userEvent.selectOptions(screen.getByLabelText('Partner type'), 'community_booth');
  await userEvent.click(screen.getByRole('button', { name: /add partner/i }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/partners', expect.objectContaining({ method: 'POST' })));
  const call = (fetchAdmin as any).mock.calls.find((entry: any[]) => entry[0] === '/api/admin/partners');
  expect(JSON.parse(call[1].body)).toMatchObject({ package_key: 'community_booth', days: ['day1', 'day2'], base_amount: 6500, gst_amount: 1170 });
});

it('deletes a partner after the confirmation dialog', async () => {
  const partner = {
    id: 'p1', edition_id: 'e1', organization_name: 'Tabletop Club', contact_name: 'Asha', phone: '9876543210',
    email: 'asha@example.com', website_url: null, gstin: null, kind: 'community_engagement',
    package_key: 'standard_engagement', days: ['day1'], details: null, internal_notes: null,
    base_amount: 3000, gst_amount: 540, total_amount: 3540, payment_status: 'pending', stage: 'prospective',
    submitted_at: null, payment_claimed_at: null, invite_url: null, invite_expires_at: null,
  };
  (fetchAdmin as any).mockImplementation((path: string) => path === '/api/admin/editions'
    ? Promise.resolve({ editions: [edition] })
    : path === '/api/admin/partners/p1' ? Promise.resolve({ partner, ok: true }) : Promise.resolve({ ok: true }));

  render(<MemoryRouter initialEntries={['/partners/p1']}><Routes><Route path="/partners/:id" element={<PartnerDrawer />} /><Route path="/partners" element={<div>Partners list</div>} /></Routes></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: /^delete partner$/i }));
  const dialog = await screen.findByRole('dialog', { name: /delete tabletop club/i });
  await userEvent.click(within(dialog).getByRole('button', { name: /^delete partner$/i }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/partners/p1', { method: 'DELETE' }));
  expect(await screen.findByText('Partners list')).toBeTruthy();
});

it('withholds delete from a confirmed partner', async () => {
  const partner = {
    id: 'p2', edition_id: 'e1', organization_name: 'Paid Club', contact_name: 'Asha', phone: '9876543210',
    email: 'asha@example.com', website_url: null, gstin: null, kind: 'booth', package_key: 'standard_booth',
    days: ['day1', 'day2'], details: null, internal_notes: null, base_amount: 8000, gst_amount: 1440,
    total_amount: 9440, payment_status: 'confirmed', stage: 'confirmed',
    submitted_at: null, payment_claimed_at: null, invite_url: null, invite_expires_at: null,
  };
  (fetchAdmin as any).mockImplementation((path: string) => path === '/api/admin/editions'
    ? Promise.resolve({ editions: [edition] })
    : path === '/api/admin/partners/p2' ? Promise.resolve({ partner, ok: true }) : Promise.resolve({ ok: true }));

  render(<MemoryRouter initialEntries={['/partners/p2']}><Routes><Route path="/partners/:id" element={<PartnerDrawer />} /><Route path="/partners" element={<div>Partners list</div>} /></Routes></MemoryRouter>);
  expect(await screen.findByText(/set the payment to cancelled/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^delete partner$/i })).toBeNull();
});
