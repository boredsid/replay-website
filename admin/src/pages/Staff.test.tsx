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

const ROWS = [
  { email: 'me@replaycon.in', name: 'Me', roles: ['admin'], added_by: null, created_at: '' },
  { email: 'vol@replaycon.in', name: 'Vol', roles: ['check_in'], added_by: 'me@replaycon.in', created_at: '' },
];

function wire(rows = ROWS) {
  fetchAdmin.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/admin/staff' && !init) return { staff: rows };
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
        body: JSON.stringify({ roles: ['check_in', 'library', 'programme'] }),
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
    wire([{ email: 'vol@replaycon.in', name: 'Vol', roles: ['admin'], added_by: null, created_at: '' }]);
    render(<Staff />);
    await screen.findByText('Vol');
    const row = within(rowFor('Vol'));

    await userEvent.click(row.getByRole('checkbox', { name: /Check-in desk/ }));
    expect(row.getByRole('checkbox', { name: /Full admin/ })).not.toBeChecked();
    expect(row.getByRole('checkbox', { name: /Check-in desk/ })).toBeChecked();
  });

  it('drops the desks when an umbrella is picked', async () => {
    wire([{ email: 'vol@replaycon.in', name: 'Vol', roles: ['check_in', 'library'], added_by: null, created_at: '' }]);
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
