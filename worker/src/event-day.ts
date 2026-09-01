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
  const today = editionDayForToday(edition, now);
  if (today) return hasArrivedOn(events, today) ? today : null;
  return ticketDays.find((day) => hasArrivedOn(events, day)) ?? null;
}
