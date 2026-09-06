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
  await user.click(screen.getByLabelText('Schedule'));
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

it('sends now with a start of this moment and a five-minute default window', async () => {
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
  // Send now is the default, so nothing is clicked to choose it, and there is
  // no start field to fill in.
  expect(screen.queryByLabelText('Starts at (IST)')).toBeNull();
  await user.type(screen.getByLabelText('Title'), 'Fire alarm test');
  await user.type(screen.getByLabelText('Message'), 'Ignore the alarm at 2pm.');
  await user.selectOptions(screen.getByLabelText('Severity'), 'urgent');
  await user.click(screen.getByLabelText('Published'));

  const before = Date.now();
  await user.click(screen.getByRole('button', { name: 'Create announcement' }));
  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/announcements', expect.objectContaining({ method: 'POST' })));
  const after = Date.now();

  const call = (fetchAdmin as any).mock.calls.find(([path]: [string]) => path === '/api/admin/announcements');
  const payload = JSON.parse(call[1].body);
  const startsAt = new Date(payload.starts_at).getTime();
  expect(startsAt).toBeGreaterThanOrEqual(before);
  expect(startsAt).toBeLessThanOrEqual(after);
  // Blank end means the default window, not forever.
  expect(new Date(payload.ends_at).getTime() - startsAt).toBe(5 * 60_000);
});

it('warns that an information notice reaches no phone', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/announcements/new?edition_id=e3']}>
      <Routes>
        <Route path="/announcements/new" element={<AnnouncementDrawer />} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole('heading', { name: 'New announcement' });
  // The trap this replaces: nothing on the form said which severities notify,
  // so an important notice filed as Information reached nobody, silently.
  expect(screen.getByText('Appears in the app only. No phone will be notified.')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Severity'), 'urgent');
  expect(screen.getByText('Sends a push notification to attendees who turned them on.')).toBeInTheDocument();
});

it('deletes an existing notice only after the confirmation is accepted', async () => {
  const user = userEvent.setup();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION] });
    if (path === '/api/admin/announcements/n1') return Promise.resolve({
      announcement: {
        id: 'n1', edition_id: 'e3', title: 'Room change', body: 'Moved to Room B.',
        severity: 'urgent', audience: 'all', starts_at: '2026-09-12T04:30:00.000Z',
        ends_at: null, is_published: false,
      },
    });
    return Promise.resolve({ ok: true });
  });

  render(
    <MemoryRouter initialEntries={['/announcements/n1']}>
      <Routes>
        <Route path="/announcements/:id" element={<AnnouncementDrawer />} />
        <Route path="/announcements" element={<div>Announcement list</div>} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole('heading', { name: 'Edit announcement' });
  await user.click(screen.getByRole('button', { name: 'Delete announcement' }));

  // The dialog stands between the button and the row: nothing has gone yet.
  await screen.findByRole('heading', { name: 'Delete “Room change”?' });
  expect((fetchAdmin as any).mock.calls.some(([, init]: [string, any]) => init?.method === 'DELETE')).toBe(false);

  await user.click(screen.getByRole('button', { name: 'Delete notice' }));
  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/announcements/n1', { method: 'DELETE' }));
  expect(await screen.findByText('Announcement list')).toBeInTheDocument();
});
