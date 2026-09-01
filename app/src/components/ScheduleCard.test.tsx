import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleCard } from './ScheduleCard';
import type { ScheduleItem } from '../types';
import type { Signup } from '../lib/signups';

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'item-1',
    day: '2026-09-12',
    start_time: '14:00:00',
    end_time: '16:00:00',
    title: 'Werewolf',
    description: null,
    location: 'Sandbox',
    kind: 'workshop',
    section: 'programme',
    is_all_day: false,
    host_name: null,
    signup_mode: 'app',
    public_status: 'published',
    display_order: 0,
    capacity: 8,
    seats_remaining: 3,
    ...overrides,
  };
}

const noop = () => {};

function renderCard(overrides: Partial<Parameters<typeof ScheduleCard>[0]> = {}) {
  return render(
    <ScheduleCard item={item()} saved={false} onToggle={noop} canBook {...overrides} />,
  );
}

const booked: Signup = { schedule_item_id: 'item-1', status: 'confirmed', signed_up_at: '', promoted_at: null, queue_position: 0 };
const waiting: Signup = { schedule_item_id: 'item-1', status: 'waitlisted', signed_up_at: '', promoted_at: null, queue_position: 3 };

describe('ScheduleCard booking', () => {
  it('offers a booking on a bookable session', () => {
    renderCard();
    expect(screen.getByRole('button', { name: /Book a place in Werewolf/i })).toBeInTheDocument();
  });

  it('offers nothing until a device is paired', () => {
    renderCard({ canBook: false });
    // The public half of the app works without setup; booking does not.
    expect(screen.queryByRole('button', { name: /Book a place/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Bookable')).toBeInTheDocument();
  });

  it('offers nothing on a session that takes no bookings', () => {
    renderCard({ item: item({ signup_mode: 'none' }) });
    expect(screen.queryByRole('button', { name: /Book a place/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Bookable')).not.toBeInTheDocument();
  });

  it('offers nothing on a cancelled session', () => {
    renderCard({ item: item({ public_status: 'cancelled' }) });
    expect(screen.queryByRole('button', { name: /Book a place/i })).not.toBeInTheDocument();
  });

  it('says join the waitlist when the seats are gone', () => {
    renderCard({ item: item({ seats_remaining: 0 }) });
    expect(screen.getByRole('button', { name: /Book a place in Werewolf/i })).toHaveTextContent('Join waitlist');
    expect(screen.getByText('Full')).toBeInTheDocument();
  });

  it('shows a seat count only when it is nearly full', () => {
    const { unmount } = renderCard({ item: item({ seats_remaining: 2 }) });
    expect(screen.getByText('2 left')).toBeInTheDocument();
    unmount();

    // "18 left" would be noise: it changes nothing about what anyone does.
    renderCard({ item: item({ seats_remaining: 18 }) });
    expect(screen.queryByText('18 left')).not.toBeInTheDocument();
  });

  it('shows a held seat, and offers to give it up', () => {
    renderCard({ signup: booked });
    const button = screen.getByRole('button', { name: /Give up your place in Werewolf/i });
    expect(button).toHaveTextContent('Booked');
    // The cross is what makes it read as undoable rather than as a label.
    expect(button.querySelector('.lucide-x')).not.toBeNull();
    expect(screen.getByText('You have a place.')).toBeInTheDocument();
  });

  it('states the queue place inside the card it belongs to', () => {
    renderCard({ signup: waiting });
    expect(screen.getByRole('button', { name: /Leave the waitlist/i })).toHaveTextContent('Waiting');
    expect(screen.getByText('You are number 3 on the waitlist.')).toBeInTheDocument();
  });

  it('says so when a place came from the waitlist', () => {
    renderCard({ signup: { ...booked, promoted_at: '2026-09-12T10:00:00Z' } });
    expect(screen.getByText('A place opened up and it is yours.')).toBeInTheDocument();
  });

  it('hides the blurb where it is just noise', () => {
    renderCard({ item: item({ description: 'A long description' }), hideDescription: true });
    expect(screen.queryByText('A long description')).not.toBeInTheDocument();
    // With nothing to reveal, the title must not pretend to be a control.
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument();
  });

  it('keeps the blurb behind a tap on the card', async () => {
    renderCard({ item: item({ description: 'A long description' }) });
    expect(screen.queryByText('A long description')).not.toBeInTheDocument();

    const disclosure = screen.getByRole('button', { expanded: false });
    await userEvent.click(disclosure);
    expect(screen.getByText('A long description')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('A long description')).not.toBeInTheDocument();
  });

  it('leaves the actions clickable independently of the disclosure', async () => {
    const onBook = vi.fn();
    renderCard({ item: item({ description: 'A long description' }), onBook });
    // Booking must not be swallowed by the card-wide tap target.
    await userEvent.click(screen.getByRole('button', { name: /Book a place/i }));
    expect(onBook).toHaveBeenCalledWith('item-1');
    expect(screen.queryByText('A long description')).not.toBeInTheDocument();
  });

  it('calls back with the session id when booking', async () => {
    const onBook = vi.fn();
    renderCard({ onBook });
    await userEvent.click(screen.getByRole('button', { name: /Book a place/i }));
    expect(onBook).toHaveBeenCalledWith('item-1');
  });

  it('calls back when giving up a place', async () => {
    const onCancelBooking = vi.fn();
    renderCard({ signup: booked, onCancelBooking });
    await userEvent.click(screen.getByRole('button', { name: /Give up your place/i }));
    expect(onCancelBooking).toHaveBeenCalledWith('item-1');
  });

  it('disables the control while a request is in flight', () => {
    renderCard({ busy: true });
    expect(screen.getByRole('button', { name: /Book a place/i })).toBeDisabled();
  });

  it('keeps saving to My Day working independently of booking', async () => {
    const onToggle = vi.fn();
    renderCard({ onToggle, canBook: false });
    // Saving is a private note; booking is a seat. They are not the same thing.
    await userEvent.click(screen.getByRole('button', { name: /Save Werewolf to My Day/i }));
    expect(onToggle).toHaveBeenCalledWith('item-1');
  });
});
