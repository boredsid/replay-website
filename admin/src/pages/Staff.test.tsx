import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchAdmin = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchAdmin: (...args: unknown[]) => fetchAdmin(...args),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/whoami', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whoami')>()),
  useWhoAmI: () => ({ email: 'me@replaycon.in', roles: ['admin'] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import Staff from './Staff';

interface Row {
  email: string; name: string; roles: string[]; events: string[];
  added_by: string | null; created_at: string;
}

const ROWS: Row[] = [
  { email: 'me@replaycon.in', name: 'Me', roles: ['admin'], events: [], added_by: null, created_at: '' },
  { email: 'vol@replaycon.in', name: 'Vol', roles: ['check_in'], events: [], added_by: 'me@replaycon.in', created_at: '' },
];

const WEREWOLF = 'b1111111-1111-1111-1111-111111111111';
const QUIZ = 'b2222222-2222-2222-2222-222222222222';

/** The programme the event picker reads, bookable and otherwise. */
const SESSIONS = [
  { id: WEREWOLF, title: 'Werewolf', day: '2026-09-12', start_time: '14:00', end_time: '16:00',
    is_all_day: false, location: 'Table 3', signup_mode: 'app' },
  { id: QUIZ, title: 'Quiz Night', day: '2026-09-13', start_time: '18:00', end_time: '19:00',
    is_all_day: false, location: null, signup_mode: 'app' },
  { id: 'b3333333-3333-3333-3333-333333333333', title: 'Open play', day: '2026-09-12',
    start_time: null, end_time: null, is_all_day: true, location: null, signup_mode: 'none' },
];

function wire(rows: Row[] = ROWS) {
  fetchAdmin.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/admin/staff' && !init) return { staff: rows };
    if (path === '/api/admin/schedule') return { items: SESSIONS };
    return { ok: true, access_sync: { synced: true, members: rows.length } };
  });
}

/** The row for somebody, so checkboxes are not confused between people. */
function rowFor(name: string) {
  return screen.getByText(name).closest('li') as HTMLElement;
}

beforeEach(() => { fetchAdmin.mockReset(); wire(); });

describe('the update button', () => {
  it('is disabled until something actually changes', async () => {
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    expect(row.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('enables once a box is ticked, and sends nothing before it is pressed', async () => {
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Game library/ }));
    expect(row.getByRole('button', { name: 'Update' })).toBeEnabled();
    // The point of the button: no request per checkbox.
    expect(fetchAdmin).not.toHaveBeenCalledWith(expect.stringContaining('vol@'), expect.anything());
  });

  it('sends every edit in one request', async () => {
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Game library/ }));
    await userEvent.click(row.getByRole('checkbox', { name: /Programme/ }));
    await userEvent.click(row.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/staff/vol%40replaycon.in', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ roles: ['check_in', 'library', 'programme'], events: [] }),
      }));
    });
    const patches = fetchAdmin.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PATCH');
    expect(patches).toHaveLength(1);
  });

  it('offers a way to abandon an edit', async () => {
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Game library/ }));
    await userEvent.click(row.getByRole('button', { name: 'Cancel' }));

    expect(row.getByRole('checkbox', { name: /Game library/ })).not.toBeChecked();
    expect(row.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('stays disabled when the edits cancel out', async () => {
    // Ticking and unticking is not a change, so it must not offer to save one.
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Game library/ }));
    await userEvent.click(row.getByRole('checkbox', { name: /Game library/ }));
    expect(row.getByRole('button', { name: 'Update' })).toBeDisabled();
  });
});

describe('roles that contain each other', () => {
  it('drops full admin when a desk is picked', async () => {
    wire([{ email: 'vol@replaycon.in', name: 'Vol', roles: ['admin'], events: [], added_by: null, created_at: '' }]);
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Check-in desk/ }));
    expect(row.getByRole('checkbox', { name: /Full admin/ })).not.toBeChecked();
    expect(row.getByRole('checkbox', { name: /Check-in desk/ })).toBeChecked();
  });

  it('drops the desks when an umbrella is picked', async () => {
    wire([{ email: 'vol@replaycon.in', name: 'Vol', roles: ['check_in', 'library'], events: [], added_by: null, created_at: '' }]);
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Basic admin/ }));
    expect(row.getByRole('checkbox', { name: /Check-in desk/ })).not.toBeChecked();
    expect(row.getByRole('checkbox', { name: /Game library/ })).not.toBeChecked();
    expect(row.getByRole('checkbox', { name: /Basic admin/ })).toBeChecked();
  });

  it('keeps two desks together, because neither contains the other', async () => {
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Game library/ }));
    expect(row.getByRole('checkbox', { name: /Check-in desk/ })).toBeChecked();
    expect(row.getByRole('checkbox', { name: /Game library/ })).toBeChecked();
  });
});

describe('handing somebody the events they run', () => {
  it('offers no session picker until the role is chosen', async () => {
    render(<Staff />);
    await screen.findByText('Vol');
    expect(screen.queryByText('Which events are theirs?')).not.toBeInTheDocument();
  });

  it('lists only sessions people can actually book', async () => {
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    await userEvent.click(row.getByRole('checkbox', { name: /Event manager/ }));

    expect(await row.findByRole('checkbox', { name: /Werewolf/ })).toBeInTheDocument();
    expect(row.getByRole('checkbox', { name: /Quiz Night/ })).toBeInTheDocument();
    // Not bookable, so it would be a grant over a page that stays empty.
    expect(row.queryByRole('checkbox', { name: /Open play/ })).not.toBeInTheDocument();
  });

  it('sends the chosen sessions beside the role', async () => {
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    await userEvent.click(row.getByRole('checkbox', { name: /Event manager/ }));
    await userEvent.click(await row.findByRole('checkbox', { name: /Werewolf/ }));
    await userEvent.click(row.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/staff/vol%40replaycon.in', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ roles: ['check_in', 'event_manager'], events: [WEREWOLF] }),
      }));
    });
  });

  it('counts a change of sessions alone as an edit worth saving', async () => {
    // Moving somebody from one tournament to another leaves their roles exactly
    // as they were, and is still the thing the admin came here to do.
    wire([{ ...ROWS[1], roles: ['event_manager'], events: [WEREWOLF] }]);
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    expect(row.getByRole('button', { name: 'Update' })).toBeDisabled();

    await userEvent.click(await row.findByRole('checkbox', { name: /Quiz Night/ }));
    expect(row.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('clears the sessions when the role is taken away', async () => {
    wire([{ ...ROWS[1], roles: ['event_manager'], events: [WEREWOLF] }]);
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    await userEvent.click(row.getByRole('checkbox', { name: /Event manager/ }));
    await userEvent.click(row.getByRole('checkbox', { name: /Check-in desk/ }));
    await userEvent.click(row.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/staff/vol%40replaycon.in', expect.objectContaining({
        body: JSON.stringify({ roles: ['check_in'], events: [] }),
      }));
    });
  });

  it('abandons a half-made assignment with the rest of the edit', async () => {
    wire([{ ...ROWS[1], roles: ['event_manager'], events: [WEREWOLF] }]);
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    await userEvent.click(await row.findByRole('checkbox', { name: /Quiz Night/ }));
    await userEvent.click(row.getByRole('button', { name: 'Cancel' }));

    expect(row.getByRole('checkbox', { name: /Werewolf/ })).toBeChecked();
    expect(row.getByRole('checkbox', { name: /Quiz Night/ })).not.toBeChecked();
  });
});

describe('when the programme cannot be read', () => {
  it('says so in the picker rather than claiming nothing is bookable', async () => {
    // Two different problems. It is also deliberately not a toast: a page about
    // staff should not open with an error about editions.
    fetchAdmin.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/admin/schedule') throw new Error('no_edition');
      if (path === '/api/admin/staff' && !init) return { staff: ROWS };
      return { ok: true };
    });
    render(<Staff />);
    const row = within(await screen.findByText('Vol').then((el) => el.closest('li') as HTMLElement));
    await userEvent.click(row.getByRole('checkbox', { name: /Event manager/ }));

    expect(await row.findByText(/programme could not be read/)).toBeInTheDocument();
    expect(row.queryByText(/Book in the app/)).not.toBeInTheDocument();
  });
});
