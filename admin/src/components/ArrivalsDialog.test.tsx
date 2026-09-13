import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { fetchAdmin } from '@/lib/api';
import ArrivalsDialog, { matchesArrival } from './ArrivalsDialog';
import type { ArrivalRow } from '@/lib/types';

const api = fetchAdmin as unknown as ReturnType<typeof vi.fn>;

function arrival(overrides: Partial<ArrivalRow> = {}): ArrivalRow {
  return {
    attendee_id: 'a1',
    name: 'Priya',
    seat_index: 1,
    is_purchaser: true,
    phone: '9876543210',
    purchaser_phone: '9876543210',
    purchaser_name: 'Priya Nair',
    purchaser_email: 'priya@example.com',
    pass_type: 'campaign',
    days: ['day1', 'day2'],
    state: { day1: 'in', day2: null },
    arrived_at: { day1: '2026-09-12T04:30:00.000Z', day2: null },
    last_seen_at: { day1: '2026-09-12T04:30:00.000Z', day2: null },
    ...overrides,
  };
}

/** A seat somebody else bought, named at the door but with no number of its own. */
const GUEST = arrival({
  attendee_id: 'a2',
  name: 'Rahul',
  seat_index: 2,
  is_purchaser: false,
  phone: null,
});

function mockArrivals(arrivals: ArrivalRow[], day: string | null = null) {
  api.mockResolvedValue({ edition: 'replay-3', day, generated_at: '2026-09-12T05:00:00.000Z', arrivals });
}

beforeEach(() => { api.mockReset(); });

describe('ArrivalsDialog', () => {
  it('shows the full number, unmasked, which is the point of the screen', async () => {
    mockArrivals([arrival()]);
    render(<ArrivalsDialog open onOpenChange={() => {}} />);

    const link = await screen.findByRole('link', { name: '+91 98765 43210' });
    expect(link).toHaveAttribute('href', 'tel:+919876543210');
  });

  it('names the buyer behind a guest seat rather than showing a bare number', async () => {
    // Knowing whose phone you are about to ring matters as much as the number.
    mockArrivals([GUEST]);
    render(<ArrivalsDialog open onOpenChange={() => {}} />);

    await screen.findByText(/No number of their own/i);
    expect(screen.getByText(/Booked by Priya Nair/)).toBeInTheDocument();
  });

  it('does not repeat the purchaser as their own buyer', async () => {
    mockArrivals([arrival()]);
    render(<ArrivalsDialog open onOpenChange={() => {}} />);

    await screen.findByText('Priya');
    expect(screen.queryByText(/Booked by/)).not.toBeInTheDocument();
  });

  it('counts who is inside separately from who has been in', async () => {
    mockArrivals([
      arrival(),
      arrival({ attendee_id: 'a3', name: 'Meera', state: { day1: 'out', day2: null } }),
    ]);
    render(<ArrivalsDialog open onOpenChange={() => {}} />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 checked in · 1 inside right now'));
  });

  it('says when somebody left, not just that they did', async () => {
    mockArrivals([arrival({
      state: { day1: 'out', day2: null },
      last_seen_at: { day1: '2026-09-12T08:45:00.000Z', day2: null },
    })]);
    render(<ArrivalsDialog open onOpenChange={() => {}} />);

    // IST, not the device's timezone: 08:45 UTC is 2:15 pm in Bangalore.
    await screen.findByText(/Sat 10:00 am · left 2:15 pm/);
  });

  it('reloads from the server when the day changes, rather than filtering here', async () => {
    // The day filter is the Worker's, so a two-day attendee is counted right.
    mockArrivals([arrival()]);
    const user = userEvent.setup();
    render(<ArrivalsDialog open onOpenChange={() => {}} />);
    await screen.findByText('Priya');

    await user.click(screen.getByRole('button', { name: 'Sun' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/admin/check-in/arrivals?day=day2'));
  });

  it('filters in the browser by name or number', async () => {
    mockArrivals([arrival(), GUEST]);
    const user = userEvent.setup();
    render(<ArrivalsDialog open onOpenChange={() => {}} />);
    await screen.findByText('Rahul');

    await user.type(screen.getByLabelText(/Filter arrivals/i), 'Rahul');
    await waitFor(() => expect(screen.queryByText('Priya')).not.toBeInTheDocument());
    expect(screen.getByText('Rahul')).toBeInTheDocument();
  });

  it('fetches nothing until it is opened', () => {
    mockArrivals([arrival()]);
    render(<ArrivalsDialog open={false} onOpenChange={() => {}} />);
    expect(api).not.toHaveBeenCalled();
  });

  it('says plainly when nobody has arrived', async () => {
    mockArrivals([]);
    render(<ArrivalsDialog open onOpenChange={() => {}} />);
    await screen.findByText(/Nobody has been checked in yet/i);
  });
});

describe('matchesArrival', () => {
  const row = arrival();

  it('keeps everything on an empty term', () => {
    expect(matchesArrival(row, '   ')).toBe(true);
  });

  it('matches a partial number, which is what a caller reads back', () => {
    expect(matchesArrival(row, '543')).toBe(true);
    expect(matchesArrival(row, '111')).toBe(false);
  });

  it('matches the buyer behind a guest seat by number', () => {
    // A guest has no number of their own; the buyer's is the only way to find
    // them by phone at all.
    expect(matchesArrival(GUEST, '98765')).toBe(true);
  });

  it('matches a name case-insensitively', () => {
    expect(matchesArrival(row, 'pri')).toBe(true);
    expect(matchesArrival(row, 'PRIYA')).toBe(true);
  });

  it('does not treat one or two digits as a number search', () => {
    // "12" is far more likely to be the start of a name being typed than a
    // phone number, and as a number it would match almost everybody.
    expect(matchesArrival(row, '98')).toBe(false);
  });
});
