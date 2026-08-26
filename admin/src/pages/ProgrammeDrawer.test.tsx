import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import ProgrammeDrawer from './ProgrammeDrawer';

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

it('creates an all-day draft without sending fake times and offers a rebuild', async () => {
  render(
    <MemoryRouter initialEntries={['/programme/new?edition_id=e3']}>
      <Routes><Route path="/programme/new" element={<ProgrammeDrawer />} /></Routes>
    </MemoryRouter>,
  );

  await userEvent.type(await screen.findByLabelText('Title'), 'Open board games');
  await userEvent.selectOptions(screen.getByLabelText('Public section'), 'always-on');
  await userEvent.selectOptions(screen.getByLabelText('Activity type'), 'open-play');
  await userEvent.click(screen.getByLabelText('All-day item'));
  expect(screen.queryByLabelText('Start time')).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: /create item/i }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/schedule', expect.objectContaining({ method: 'POST' })));
  const call = (fetchAdmin as any).mock.calls.find((entry: any[]) => entry[0] === '/api/admin/schedule');
  const body = JSON.parse(call[1].body);
  expect(body).toMatchObject({
    edition_id: 'e3',
    day: '2026-09-12',
    title: 'Open board games',
    is_all_day: true,
    start_time: null,
    end_time: null,
    public_status: 'draft',
  });
  expect(await screen.findByText(/rebuild the public site\?/i)).toBeInTheDocument();
});

it('offers story-game as an activity type and sends it on create', async () => {
  render(
    <MemoryRouter initialEntries={['/programme/new?edition_id=e3']}>
      <Routes><Route path="/programme/new" element={<ProgrammeDrawer />} /></Routes>
    </MemoryRouter>,
  );

  await userEvent.type(await screen.findByLabelText('Title'), 'Fiasco one-shot');
  await userEvent.selectOptions(screen.getByLabelText('Activity type'), 'story-game');
  await userEvent.click(screen.getByRole('button', { name: /create item/i }));

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/schedule', expect.objectContaining({ method: 'POST' })));
  const call = (fetchAdmin as any).mock.calls.find((entry: any[]) => entry[0] === '/api/admin/schedule');
  expect(JSON.parse(call[1].body)).toMatchObject({ title: 'Fiasco one-shot', kind: 'story-game' });
});
