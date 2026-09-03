import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchAdmin = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchAdmin: (...args: unknown[]) => fetchAdmin(...args),
  showApiError: vi.fn(),
  ApiError: class extends Error {},
}));
// The camera is not the subject here; the desk logic is.
vi.mock('@/components/QrScanner', () => ({
  default: ({ onScan }: { onScan: (t: string) => void }) => (
    <button type="button" onClick={() => onScan('TOKEN123')}>Simulate scan</button>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Library from './Library';

const HOLD = {
  loan_id: 'l-hold', copy_id: 'copy-1', copy_number: 2,
  title: 'Catan', title_key: 'bgg-1',
  expires_at: new Date(Date.now() + 120_000).toISOString(), expired: false,
};
const LOAN = {
  loan_id: 'l-open', copy_id: 'copy-9', copy_number: 1,
  title: 'Wingspan', title_key: 'bgg-2',
  due_at: new Date(Date.now() + 3_600_000).toISOString(), overdue: false,
};

function scanReply(library: Record<string, unknown>) {
  return {
    attendee_id: 'att-1', name: 'Siddhant Narula', pass_type: 'campaign',
    days: ['day1', 'day2'], arrived_today: true, library,
  };
}

function wire(options: { library?: Record<string, unknown>; loans?: unknown[]; people?: unknown[] } = {}) {
  fetchAdmin.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/library/loans')) {
      const loans = options.loans ?? [];
      return { loans, overdue_count: loans.filter((l) => (l as { overdue: boolean }).overdue).length };
    }
    if (path === '/api/admin/scan') return scanReply(options.library ?? { hold: null, loan: null });
    if (path.startsWith('/api/admin/library/titles')) return { titles: [] };
    if (path.startsWith('/api/admin/sessions/attendees')) {
      return { attendees: options.people ?? [] };
    }
    if (path.startsWith('/api/admin/library/attendees/')) {
      return scanReply(options.library ?? { hold: null, loan: null });
    }
    return { ok: true };
  });
}

function renderDesk() {
  render(<MemoryRouter><Library /></MemoryRouter>);
}

beforeEach(() => { fetchAdmin.mockReset(); });

describe('the desk', () => {
  it('offers the hold when somebody has requested a game', async () => {
    wire({ library: { hold: HOLD, loan: null } });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));

    expect(await screen.findByText('Catan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand it over' })).toBeInTheDocument();
    // Nothing about returning: they have nothing to return.
    expect(screen.queryByRole('button', { name: 'Take it back' })).not.toBeInTheDocument();
  });

  it('offers the return when somebody already has a game', async () => {
    wire({ library: { hold: null, loan: LOAN } });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));

    expect(await screen.findByRole('button', { name: 'Take it back' })).toBeInTheDocument();
    // Staff never choose a mode; the reply decides which action exists.
    expect(screen.queryByRole('button', { name: 'Hand it over' })).not.toBeInTheDocument();
  });

  it('still offers a lapsed hold, and says it lapsed', async () => {
    wire({ library: { hold: { ...HOLD, expired: true }, loan: null } });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));

    expect(await screen.findByText(/hold lapsed, copy still free/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand it over' })).toBeInTheDocument();
  });

  it('flags somebody who has not checked in', async () => {
    fetchAdmin.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/library/loans')) return { loans: [], overdue_count: 0 };
      if (path === '/api/admin/scan') return { ...scanReply({ hold: null, loan: null }), arrived_today: false };
      return { ok: true };
    });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));
    expect(await screen.findByText('Not checked in')).toBeInTheDocument();
  });

  it('checks out the held copy against the scanned attendee', async () => {
    wire({ library: { hold: HOLD, loan: null } });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hand it over' }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/library/checkout', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ attendee_id: 'att-1', copy_id: 'copy-1' }),
      }));
    });
  });

  it('will not return a damaged copy without a reason', async () => {
    // A withdrawal with no note is a copy nobody can put back with confidence.
    vi.spyOn(window, 'prompt').mockReturnValue('');
    wire({ library: { hold: null, loan: LOAN } });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back, but damaged' }));

    expect(fetchAdmin).not.toHaveBeenCalledWith('/api/admin/library/return', expect.anything());
    vi.restoreAllMocks();
  });

  it('sends the damage note with the return', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('two meeples missing');
    wire({ library: { hold: null, loan: LOAN } });
    renderDesk();
    await userEvent.click(screen.getByRole('button', { name: 'Simulate scan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back, but damaged' }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/library/return', expect.objectContaining({
        body: JSON.stringify({ loan_id: 'l-open', withdraw_note: 'two meeples missing' }),
      }));
    });
    vi.restoreAllMocks();
  });
});

describe('what is out', () => {
  const overdue = {
    loan_id: 'l1', attendee_id: 'a1', attendee_name: 'Siddhant Narula',
    contact_phone: '9982200768', contact_is_purchaser: false,
    title: 'Catan', title_key: 'bgg-1', copy_number: 1,
    checked_out_at: '', due_at: '', overdue: true, minutes_remaining: -42,
  };

  it('counts what is late and says how late', async () => {
    wire({ loans: [overdue] });
    renderDesk();
    expect(await screen.findByText(/1 overdue/)).toBeInTheDocument();
    expect(screen.getByText('42 min over')).toBeInTheDocument();
  });

  it('shows a callable number, and says when it is the buyer\'s', async () => {
    // A guest on seat 2 has no phone of their own; staff need to know whose
    // number they are about to ring.
    wire({ loans: [{ ...overdue, attendee_name: 'Guest 2', contact_is_purchaser: true }] });
    renderDesk();
    const link = await screen.findByRole('link', { name: '9982200768' });
    expect(link).toHaveAttribute('href', 'tel:9982200768');
    expect(screen.getByText('(purchaser)')).toBeInTheDocument();
  });

  it('returns a copy from the list without any scan at all', async () => {
    // The fallback path: the attendee is not there, or their phone is dead.
    wire({ loans: [overdue] });
    renderDesk();
    await userEvent.click(await screen.findByRole('button', { name: 'Returned' }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/library/return', expect.objectContaining({
        body: JSON.stringify({ loan_id: 'l1', withdraw_note: null }),
      }));
    });
  });

  it('says so when the shelf is whole', async () => {
    wire({ loans: [] });
    renderDesk();
    expect(await screen.findByText('Nothing is out right now.')).toBeInTheDocument();
  });
});


describe('lending without the app', () => {
  const PERSON = { attendee_id: 'att-1', name: 'Siddhant Narula', phone_masked: '·····0768' };

  it('finds somebody by phone and opens the same panel a scan would', async () => {
    // A dead battery or a declined install must not shut the library to
    // someone. The panel and its actions are identical either way.
    wire({ people: [PERSON], library: { hold: null, loan: LOAN } });
    renderDesk();
    await userEvent.type(screen.getByLabelText(/Find them by phone or name/), '0768');
    await userEvent.click(await screen.findByRole('button', { name: /Siddhant Narula/ }));

    expect(await screen.findByRole('button', { name: 'Take it back' })).toBeInTheDocument();
  });

  it('does not search on a single character', async () => {
    wire({ people: [PERSON] });
    renderDesk();
    await userEvent.type(screen.getByLabelText(/Find them by phone or name/), '0');
    expect(fetchAdmin).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/sessions/attendees'),
    );
  });

  it('refreshes through the same path after an action', async () => {
    wire({ people: [PERSON], library: { hold: HOLD, loan: null } });
    renderDesk();
    await userEvent.type(screen.getByLabelText(/Find them by phone or name/), '0768');
    await userEvent.click(await screen.findByRole('button', { name: /Siddhant Narula/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hand it over' }));

    // Re-read by id, not by a token this person never had.
    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/library/attendees/att-1');
    });
  });
});
