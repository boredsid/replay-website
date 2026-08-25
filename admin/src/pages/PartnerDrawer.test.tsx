import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
