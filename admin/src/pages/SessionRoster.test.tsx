import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
import { fetchAdmin } from '@/lib/api';
import { toast } from 'sonner';
import SessionRoster from './SessionRoster';

const api = fetchAdmin as unknown as ReturnType<typeof vi.fn>;
const SESSION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function roster(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      id: SESSION, title: 'Werewolf', day: '2026-09-12', start_time: '14:00:00',
      capacity: 2, signup_mode: 'app', seats_remaining: 1,
    },
    confirmed: [{ attendee_id: 'a1', name: 'Priya', phone_masked: '••••3210', signed_up_at: '2026-09-12T09:00:00Z', promoted: false }],
    waitlisted: [{ attendee_id: 'a2', name: 'Arjun', phone_masked: null, signed_up_at: '2026-09-12T09:05:00Z', promoted: false }],
    ...overrides,
  };
}

function renderRoster() {
  return render(
    <MemoryRouter initialEntries={[`/programme/${SESSION}/roster`]}>
      <Routes><Route path="/programme/:id/roster" element={<SessionRoster />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { api.mockReset(); vi.clearAllMocks(); });

describe('SessionRoster', () => {
  it('shows the seated and the queue separately', async () => {
    api.mockResolvedValue(roster());
    renderRoster();

    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    expect(screen.getByText(/In the session \(1 \/ 2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Arjun')).toBeInTheDocument();
  });

  it('warns when the session is not open for app booking', async () => {
    api.mockResolvedValue(roster({ session: { ...roster().session, signup_mode: 'walk-in' } }));
    renderRoster();

    // Staff should know why nobody is adding themselves.
    await waitFor(() => expect(screen.getByText(/not set to “Book in the app”/)).toBeInTheDocument());
  });

  it('adds someone found by search through the booking endpoint', async () => {
    api.mockImplementation(async (path: string) => {
      if (path.includes('/roster')) return roster();
      if (path.includes('/attendees')) return { attendees: [{ attendee_id: 'a9', name: 'Meera', phone_masked: '••••1111' }] };
      return { status: 'confirmed', queue_position: 0 };
    });
    const user = userEvent.setup();
    renderRoster();
    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());

    await user.type(screen.getByLabelText(/Find an attendee to add/i), 'Meera');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(screen.getByText(/Meera/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([p]) => p === `/api/admin/sessions/${SESSION}/signups`);
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body)).toEqual({ attendee_id: 'a9' });
    });
  });

  it('tells staff to pass on a promotion, since nothing else will', async () => {
    api.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return { removed: true, promoted_attendee_id: 'a2' };
      return roster();
    });
    const user = userEvent.setup();
    renderRoster();
    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    // There is no push notification yet, so a human has to do it.
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('let them know')));
  });

  it('never renders a whole phone number', async () => {
    api.mockResolvedValue(roster());
    renderRoster();
    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    expect(screen.queryByText(/9876543210/)).not.toBeInTheDocument();
  });

  it('handles an empty session without looking broken', async () => {
    api.mockResolvedValue(roster({ confirmed: [], waitlisted: [] }));
    renderRoster();
    await waitFor(() => expect(screen.getByText('Nobody yet.')).toBeInTheDocument());
    expect(screen.getByText('Nobody waiting.')).toBeInTheDocument();
  });
});
