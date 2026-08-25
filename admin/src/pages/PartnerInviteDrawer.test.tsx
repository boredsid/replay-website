import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import PartnerInviteDrawer from './PartnerInviteDrawer';

const edition = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', is_current: true,
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
};

const INVITE_URL = 'https://replaycon.in/partner/?t=a1b2c3d4e5f6a7b8c9d0e1f2';

function renderDrawer() {
  return render(
    <MemoryRouter initialEntries={['/partners/invite?edition_id=e1']}>
      <Routes>
        <Route path="/partners/invite" element={<PartnerInviteDrawer />} />
        <Route path="/partners" element={<div>Partners list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => path === '/api/admin/editions'
    ? Promise.resolve({ editions: [edition] })
    : Promise.resolve({ ok: true, partner: { id: 'p1', organization_name: 'Meeple Mart' }, invite_url: INVITE_URL }));
});

it('creates a sponsorship link with the negotiated amount and shows it to copy', async () => {
  renderDrawer();

  await userEvent.type(await screen.findByLabelText('Partner name'), 'Meeple Mart');
  await userEvent.selectOptions(screen.getByLabelText('Partner type'), 'zone_sponsor');
  await userEvent.clear(screen.getByLabelText('Amount before GST'));
  await userEvent.type(screen.getByLabelText('Amount before GST'), '12000');
  await userEvent.click(screen.getByRole('button', { name: /create link/i }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/partners/invites', expect.objectContaining({ method: 'POST' })));
  const call = (fetchAdmin as any).mock.calls.find((entry: any[]) => entry[0] === '/api/admin/partners/invites');
  expect(JSON.parse(call[1].body)).toMatchObject({
    edition_id: 'e1',
    organization_name: 'Meeple Mart',
    package_key: 'zone_sponsor',
    base_amount: 12000,
  });
  expect(await screen.findByText(INVITE_URL)).toBeInTheDocument();
});

it('suggests the edition price for a self-serve package and asks for its day', async () => {
  renderDrawer();

  await userEvent.type(await screen.findByLabelText('Partner name'), 'Dice Cafe');
  await userEvent.selectOptions(screen.getByLabelText('Partner type'), 'standard_engagement');
  expect(screen.getByLabelText('Amount before GST')).toHaveValue(3000);
  await userEvent.selectOptions(screen.getByLabelText('Activity day'), 'day2');
  await userEvent.click(screen.getByRole('button', { name: /create link/i }));

  const call = await waitFor(() => {
    const found = (fetchAdmin as any).mock.calls.find((entry: any[]) => entry[0] === '/api/admin/partners/invites');
    expect(found).toBeTruthy();
    return found;
  });
  expect(JSON.parse(call[1].body)).toMatchObject({ package_key: 'standard_engagement', day: 'day2', base_amount: 3000, gst_amount: 540 });
});
