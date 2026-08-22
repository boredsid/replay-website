import type { AnnouncementData, EditionData } from '../types';

/** The IST calendar date for an instant, as `YYYY-MM-DD`. */
export function istDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Which event day we are on, or null when today is not an event day.
 *
 * A single-day edition has `start_date === end_date`; it counts as day 1.
 */
export function currentEventDay(edition: EditionData | null, now: Date): 'day1' | 'day2' | null {
  if (!edition) return null;
  const today = istDate(now);
  if (today === edition.start_date) return 'day1';
  if (today === edition.end_date) return 'day2';
  return null;
}

/**
 * Drop announcements aimed at the other day.
 *
 * Deliberately conservative: an announcement is hidden only when we positively
 * know we are on the *other* event day. Before, between, and after the event
 * there is no day context, so everything published stays visible rather than
 * risking a silently withheld notice.
 */
export function visibleAnnouncements(
  announcements: AnnouncementData[],
  edition: EditionData | null,
  now: Date,
): AnnouncementData[] {
  const day = currentEventDay(edition, now);
  if (!day) return announcements;
  return announcements.filter((item) => item.audience === 'all' || item.audience === day);
}
