// When "today" is, for an edition, and whether an attendee has earned the app.
//
// Shared by the desk (which issues codes) and the public sign-up routes, so the
// rule cannot drift between the two and start disagreeing in front of someone.
import { hasArrivedOn, type CheckInEvent, type EventDay } from './admin/check-in-state';

/**
 * Which day "today" is for this edition, or null when the event is not running.
 *
 * Pairing is gated on having arrived today, so outside the event there is
 * nothing to gate on and no code to issue.
 */
export function editionDayForToday(
  edition: { start_date: string; end_date: string },
  now: Date = new Date(),
): EventDay | null {
  // The event runs in IST; comparing date strings keeps this free of timezone
  // arithmetic that would silently shift the boundary by five and a half hours.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  if (today === edition.start_date) return 'day1';
  if (today === edition.end_date) return 'day2';
  return null;
}

/**
 * Whether this attendee may be handed a code right now, and on what basis.
 *
 * During the event the rule is strict: they must have arrived **today**. That is
 * what keeps "paired" meaning "actually here", which is what the sign-up gate
 * later rests on.
 *
 * Outside the event it relaxes to "arrived on any day this ticket covers".
 * Nothing is bookable then, so the in-the-building invariant has nothing to
 * protect — and without this the entire pairing flow would first be exercised at
 * the door on day one, which is the worst possible place to find a problem.
 *
 * Returns the qualifying day, or null.
 */
export function pairingGateDay(
  edition: { start_date: string; end_date: string },
  ticketDays: readonly EventDay[],
  events: readonly CheckInEvent[],
  now?: Date,
): EventDay | null {
  // Expressed through `bookableDays` rather than beside it: pairing and booking
  // ask the same question of the same events, and two spellings of one rule is
  // how they would start answering it differently.
  return bookableDays(edition, ticketDays, events, now)[0] ?? null;
}

/** The calendar date an edition day falls on. */
export function dateForDay(
  edition: { start_date: string; end_date: string },
  day: EventDay,
): string {
  return day === 'day1' ? edition.start_date : edition.end_date;
}

/**
 * Which days this attendee may book sessions for right now.
 *
 * Deliberately narrower than "has a ticket for": a ticket covering both days
 * does not let someone hold Sunday seats from their sofa on Saturday. During the
 * event the only bookable day is the one they have actually turned up for, so a
 * held seat always means somebody in the building — and a seat they cannot use
 * is never taken out of circulation for somebody who can.
 *
 * Outside the event it relaxes to every ticket day they have arrived on, for the
 * same reason `pairingGateDay` does: the whole flow has to be rehearsable
 * somewhere other than the door on day one.
 */
export function bookableDays(
  edition: { start_date: string; end_date: string },
  ticketDays: readonly EventDay[],
  events: readonly CheckInEvent[],
  now?: Date,
): EventDay[] {
  const today = editionDayForToday(edition, now);
  if (today) return hasArrivedOn(events, today) ? [today] : [];
  return ticketDays.filter((day) => hasArrivedOn(events, day));
}
