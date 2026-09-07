import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchAdmin = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchAdmin: (...args: unknown[]) => fetchAdmin(...args),
  showApiError: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let canManage = true;
vi.mock('@/lib/whoami', () => ({ useCanManageEvents: () => canManage }));

const downloadCsv = vi.fn();
vi.mock('@/lib/csv', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csv')>('@/lib/csv');
  return { ...actual, downloadCsv: (...args: unknown[]) => downloadCsv(...args) };
});

import { emitRevalidate } from '@/lib/revalidate';
import Events from './Events';

const PRIYA = { attendee_id: 'att-1', name: 'Priya', phone_masked: '••••3210', signed_up_at: '2026-09-12T09:00:00Z', promoted: false };
const ARJUN = { attendee_id: 'att-2', name: 'Arjun', phone_masked: null, signed_up_at: '2026-09-12T09:05:00Z', promoted: false };
const MEERA = { attendee_id: 'att-3', name: 'Meera', phone_masked: null, signed_up_at: '2026-09-12T09:10:00Z', promoted: false };

const OVERVIEW = {
  edition: { id: 'ed-1', slug: 'replay-3', name: 'REPLAY' },
  sessions: [
    {
      id: 'sess-1', title: 'Werewolf', day: '2026-09-12', start_time: '14:00', end_time: '16:00',
      is_all_day: false, location: 'Table 3', host_name: 'Priya', kind: 'social-game',
      section: 'programme', capacity: 2, public_status: 'published', seats_remaining: 0,
      confirmed: [PRIYA, ARJUN], waitlisted: [MEERA],
    },
    {
      id: 'sess-2', title: 'Quiz Night', day: '2026-09-13', start_time: '18:00', end_time: '19:00',
      is_all_day: false, location: null, host_name: null, kind: 'quiz',
      section: 'programme', capacity: 10, public_status: 'published', seats_remaining: 10,
      confirmed: [], waitlisted: [],
    },
  ],
};

function draw() {
  return render(<MemoryRouter><Events /></MemoryRouter>);
}

/**
 * Stands in for the real `fetchAdmin`, including the part the page relies on:
 * it fires a revalidate after any write, which is what reloads the board. A
 * mock that only returned data would make the page look broken here and fine in
 * production, or the reverse.
 */
function stubApi(found: Array<{ attendee_id: string; name: string; phone_masked: string | null }> = []) {
  fetchAdmin.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/admin/events') return structuredClone(OVERVIEW);
    if (path.startsWith('/api/admin/sessions/attendees')) return { attendees: found };
    if (path === '/api/admin/events/signups') {
      const body = init?.method === 'POST'
        ? { status: 'confirmed', queue_position: 0 }
        : { removed: true, promoted_attendee_id: null };
      emitRevalidate();
      return body;
    }
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  canManage = true;
  stubApi([{ attendee_id: 'att-1', name: 'Priya', phone_masked: '••••3210' }]);
});

describe('the state of the day', () => {
  it('reads the whole edition in one request, not one per session', async () => {
    draw();
    await screen.findByText('Werewolf');
    expect(fetchAdmin).toHaveBeenCalledTimes(1);
    expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/events');
  });

  it('totals what is taken, what is waiting and what has filled', async () => {
    draw();
    await screen.findByText('Werewolf');
    const tile = (label: string) => screen.getByText(label).parentElement!;
    expect(within(tile('Seats taken')).getByText('2')).toBeInTheDocument();
    expect(within(tile('On waitlists')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Full')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Bookable sessions')).getByText('2')).toBeInTheDocument();
  });

  it('shows how full each session is without opening it', async () => {
    draw();
    await screen.findByText('Werewolf');
    expect(screen.getByText('2 / 2 · 1 waiting')).toBeInTheDocument();
    expect(screen.getByText('0 / 10')).toBeInTheDocument();
  });

  it('opens a session to show both lists, in queue order', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByText('Werewolf'));
    expect(await screen.findByText(/In the session \(2 \/ 2\)/)).toBeInTheDocument();
    expect(screen.getByText('Waiting (1)')).toBeInTheDocument();
    expect(screen.getByText('Meera')).toBeInTheDocument();
  });
});

describe('what has this person booked', () => {
  it('answers across the whole programme from the payload already loaded', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Werewolf');

    await user.type(screen.getByLabelText('Find an attendee'), '3210');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    // Clear only renders once somebody is selected.
    await screen.findByRole('button', { name: 'Clear' });
    // Werewolf now appears twice: in the session list and in their bookings.
    expect(screen.getAllByText(/Werewolf/)).toHaveLength(2);
    expect(fetchAdmin).toHaveBeenCalledWith(expect.stringContaining('/api/admin/sessions/attendees?q=3210'));
    // Their bookings are a filter over the payload already loaded, so finding
    // somebody costs one lookup and no second read of the programme.
    expect(fetchAdmin).toHaveBeenCalledTimes(2);
  });

  it('says plainly when somebody has booked nothing', async () => {
    const user = userEvent.setup();
    stubApi([{ attendee_id: 'att-9', name: 'Nobody', phone_masked: null }]);
    draw();
    await screen.findByText('Werewolf');
    await user.type(screen.getByLabelText('Find an attendee'), 'Nobody');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('No sessions booked.')).toBeInTheDocument();
  });

  it('shows a queue place rather than implying a seat', async () => {
    const user = userEvent.setup();
    stubApi([{ attendee_id: 'att-3', name: 'Meera', phone_masked: null }]);
    draw();
    await screen.findByText('Werewolf');
    await user.type(screen.getByLabelText('Find an attendee'), 'Meera');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('waiting #1')).toBeInTheDocument();
  });
});

describe('managing bookings', () => {
  it('removes somebody through the events endpoint and reloads', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByText('Werewolf'));
    const row = (await screen.findByText('Priya', { selector: 'li span' })).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/events/signups', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ schedule_item_id: 'sess-1', attendee_id: 'att-1' }),
    })));

    // Once on mount, once after the write — the reload rides on fetchAdmin's
    // revalidate rather than a hand-written one, so it happens exactly once.
    await waitFor(() => {
      const reads = fetchAdmin.mock.calls.filter(([path]) => path === '/api/admin/events');
      expect(reads).toHaveLength(2);
    });
  });

  it('books somebody found in the lookup into a chosen session', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Quiz Night');
    await user.type(screen.getByLabelText('Find an attendee'), 'Priya');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    await user.click(screen.getByText('Quiz Night'));
    await user.click(await screen.findByRole('button', { name: 'Add someone' }));
    await user.click(await screen.findByRole('button', { name: 'Book them in' }));

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/events/signups', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ schedule_item_id: 'sess-2', attendee_id: 'att-1' }),
    })));
  });
});

describe('a member of staff who may only look', () => {
  it('is offered no way to change a booking', async () => {
    canManage = false;
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByText('Werewolf'));
    await screen.findByText(/In the session/);
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add someone' })).not.toBeInTheDocument();
  });

  it('still sees the lists, the counts and the export', async () => {
    canManage = false;
    draw();
    await screen.findByText('Werewolf');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    expect(screen.getByText('Seats taken')).toBeInTheDocument();
  });
});

describe('the export', () => {
  it('writes a file named for the edition', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Werewolf');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('replay-3-event-bookings.csv', expect.stringContaining('Werewolf'));
  });
});
