import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  },
}));
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn(), ApiError: FakeApiError }));
const state = vi.hoisted(() => ({ canWrite: true }));
vi.mock('@/lib/whoami', () => ({ useCanWrite: () => state.canWrite }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
  state.canWrite = true;
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

const ITEM = {
  id: 'i1', edition_id: 'e3', day: '2026-09-12', title: 'Fiasco one-shot',
  section: 'programme', kind: 'story-game', is_all_day: false,
  start_time: '14:00:00', end_time: '16:00:00', host_name: null, location: null,
  description: null, signup_mode: 'app', capacity: 6, public_status: 'published', display_order: 0,
};

function editDrawer(onDelete?: () => Promise<unknown>) {
  (fetchAdmin as any).mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [EDITION] });
    if (path === '/api/admin/schedule/i1' && init?.method === 'DELETE' && onDelete) return onDelete();
    if (path === '/api/admin/schedule/i1') return Promise.resolve({ item: ITEM });
    return Promise.resolve({ ok: true });
  });
  return render(
    <MemoryRouter initialEntries={['/programme/i1']}>
      <Routes><Route path="/programme/:id" element={<ProgrammeDrawer />} /></Routes>
    </MemoryRouter>,
  );
}

/** The drawer and the confirm dialog both say "Delete item"; this is the dialog's. */
async function confirmDelete() {
  await userEvent.click(await screen.findByRole('button', { name: /^delete item$/i }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: /^delete item$/i }));
}

it('deletes an item after confirming, then offers a rebuild', async () => {
  editDrawer();
  await screen.findByLabelText('Title');
  await confirmDelete();

  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/schedule/i1', { method: 'DELETE' }));
  expect(await screen.findByText(/rebuild the public site\?/i)).toBeInTheDocument();
});

it('explains that a booked session must be cancelled rather than deleted', async () => {
  editDrawer(() => Promise.reject(new FakeApiError(409, 'session_has_signups')));
  await screen.findByLabelText('Title');
  await confirmDelete();

  const { toast } = await import('sonner');
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/cancelled instead/i)));
  expect(screen.queryByText(/rebuild the public site\?/i)).toBeNull();
});

it('hides the delete button from staff who may only read the programme', async () => {
  state.canWrite = false;
  editDrawer();

  await screen.findByLabelText('Title');
  expect(screen.queryByRole('button', { name: /^delete item$/i })).toBeNull();
});
