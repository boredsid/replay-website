import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import AnnouncementDrawer from './AnnouncementDrawer';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  registration_status: 'upcoming', is_current: true, is_published: true,
};

beforeEach(() => {
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION] });
    return Promise.resolve({ ok: true });
  });
});

it('creates a published urgent notice using explicit IST timestamps', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/announcements/new?edition_id=e3']}>
      <Routes>
        <Route path="/announcements/new" element={<AnnouncementDrawer />} />
        <Route path="/announcements" element={<div>Announcement list</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole('heading', { name: 'New announcement' });
  await user.type(screen.getByLabelText('Title'), 'Room change');
  await user.type(screen.getByLabelText('Message'), 'The tournament has moved to Room B.');
  await user.selectOptions(screen.getByLabelText('Severity'), 'urgent');
  await user.selectOptions(screen.getByLabelText('Audience'), 'day1');
  await user.clear(screen.getByLabelText('Starts at (IST)'));
  await user.type(screen.getByLabelText('Starts at (IST)'), '2026-09-12T10:00');
  await user.type(screen.getByLabelText('Ends at (IST, optional)'), '2026-09-12T13:00');
  await user.click(screen.getByLabelText('Published'));
  await user.click(screen.getByRole('button', { name: 'Create announcement' }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/announcements', expect.objectContaining({ method: 'POST' })));
  const call = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path === '/api/admin/announcements');
  const payload = JSON.parse(call[1].body);
  expect(payload).toMatchObject({
    edition_id: 'e3', title: 'Room change', severity: 'urgent', audience: 'day1', is_published: true,
    starts_at: '2026-09-12T04:30:00.000Z', ends_at: '2026-09-12T07:30:00.000Z',
  });
  expect(await screen.findByText('Announcement list')).toBeInTheDocument();
});
