import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
import { fetchAdmin } from '@/lib/api';
import CheckIn from './CheckIn';

const api = fetchAdmin as unknown as ReturnType<typeof vi.fn>;

function attendee(overrides: Record<string, unknown> = {}) {
  return {
    attendee_id: 'a1',
    seat_index: 1,
    name: 'Priya',
    has_name: true,
    phone_masked: '••••3210',
    has_phone: true,
    is_purchaser: true,
    state: { day1: null, day2: null },
    last_event: { day1: null, day2: null },
    valid_days: ['day1', 'day2'],
    can_pair: false,
    ...overrides,
  };
}

function registration(attendees: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    registration_id: 'r1',
    purchaser_phone_masked: '••••3210',
    pass_type: 'campaign',
    days: ['day1', 'day2'],
    seats: attendees.length,
    attendees,
    ...overrides,
  };
}

async function searchFor(term = '9876543210') {
  const user = userEvent.setup();
  render(<CheckIn />);
  await user.type(screen.getByLabelText(/Search by purchaser phone/i), term);
  await user.click(screen.getByRole('button', { name: 'Search' }));
  return user;
}

beforeEach(() => { api.mockReset(); });

describe('CheckIn', () => {
  it('offers undo for a day that has something to reverse', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee({ state: { day1: 'in', day2: null }, last_event: { day1: 'evt-1', day2: null } }),
      ])],
    });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Undo last Sat action for Priya/i })).toBeInTheDocument();
    // Nothing has happened on Sunday, so there is nothing to undo there.
    expect(screen.queryByRole('button', { name: /Undo last Sun action/i })).not.toBeInTheDocument();
  });

  it('sends the event id to the undo endpoint', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee({ state: { day1: 'in', day2: null }, last_event: { day1: 'evt-1', day2: null } }),
      ])],
    });
    const user = await searchFor();
    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Undo last Sat action for Priya/i }));

    await waitFor(() => {
      const undoCall = api.mock.calls.find(([path]) => path === '/api/admin/check-in/undo');
      expect(undoCall).toBeDefined();
      expect(JSON.parse(undoCall![1].body)).toMatchObject({ event_id: 'evt-1' });
    });
  });

  it('disables a day the ticket does not cover, rather than hiding the person', async () => {
    api.mockResolvedValue({
      registrations: [registration([attendee({ valid_days: ['day1'] })], { days: ['day1'] })],
    });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    const refused = screen.getByRole('button', { name: /Sun · not on ticket/i });
    expect(refused).toBeDisabled();
  });

  it('asks for a name only when the seat does not have one', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee(),
        attendee({ attendee_id: 'a2', seat_index: 2, name: 'Guest 2', has_name: false, has_phone: false, phone_masked: null, is_purchaser: false }),
      ])],
    });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Guest 2')).toBeInTheDocument());
    expect(screen.getByLabelText('Name for seat 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name for seat 1')).not.toBeInTheDocument();
  });

  it('sends the captured name with the check-in itself, not as a separate edit', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee({ attendee_id: 'a2', seat_index: 2, name: 'Guest 2', has_name: false, has_phone: false, phone_masked: null, is_purchaser: false }),
      ])],
    });
    const user = await searchFor();
    await waitFor(() => expect(screen.getByText('Guest 2')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Name for seat 2'), 'Arjun');
    await user.click(screen.getByRole('button', { name: /Check in · Sat/i }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path]) => path === '/api/admin/check-in');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body)).toMatchObject({
        attendee_id: 'a2', day: 'day1', kind: 'in', display_name: 'Arjun',
      });
    });
  });

  it('checks a returning attendee out rather than in', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee({ state: { day1: 'in', day2: null }, last_event: { day1: 'evt-1', day2: null } }),
      ])],
    });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Check out · Sat/i })).toBeInTheDocument();
  });

  it('offers check-in-all only for a group', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee(),
        attendee({ attendee_id: 'a2', seat_index: 2, name: 'Guest 2', has_name: false, is_purchaser: false }),
      ])],
    });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Guest 2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Check in all · Sat/i })).toBeInTheDocument();
  });

  it('does not offer check-in-all for a single seat', async () => {
    api.mockResolvedValue({ registrations: [registration([attendee()])] });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Check in all/i })).not.toBeInTheDocument();
  });

  it('never renders a full phone number', async () => {
    api.mockResolvedValue({ registrations: [registration([attendee()])] });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());
    expect(screen.queryByText('9876543210')).not.toBeInTheDocument();
  });
});

describe('pairing code', () => {
  it('offers a code only once the attendee has arrived today', async () => {
    api.mockResolvedValue({
      registrations: [registration([
        attendee({ can_pair: true }),
        attendee({ attendee_id: 'a2', seat_index: 2, name: 'Guest 2', has_name: false, is_purchaser: false, can_pair: false }),
      ])],
    });
    await searchFor();

    await waitFor(() => expect(screen.getByText('Guest 2')).toBeInTheDocument());
    // One button, for the one person who can pair.
    expect(screen.getAllByRole('button', { name: 'Get app code' })).toHaveLength(1);
  });

  it('labels the revealed code with the attendee, so two at the desk cannot be confused', async () => {
    api.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/check-in/search')) {
        return { registrations: [registration([attendee({ can_pair: true })])] };
      }
      return { code: 'A1B2C3D4', expires_at: new Date(Date.now() + 180_000).toISOString(), attendee_name: 'Priya' };
    });
    const user = await searchFor();
    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Get app code' }));

    await waitFor(() => expect(screen.getByText('A1B2C3D4')).toBeInTheDocument());
    expect(screen.getByText(/App code for Priya/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New code' })).toBeInTheDocument();
  });

  it('shows an expired code as expired rather than leaving it readable', async () => {
    api.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/check-in/search')) {
        return { registrations: [registration([attendee({ can_pair: true })])] };
      }
      return { code: 'A1B2C3D4', expires_at: new Date(Date.now() - 1000).toISOString(), attendee_name: 'Priya' };
    });
    const user = await searchFor();
    await waitFor(() => expect(screen.getByText('Priya')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Get app code' }));

    await waitFor(() => expect(screen.getByText(/Expired/i)).toBeInTheDocument());
  });
});
