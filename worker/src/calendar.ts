// worker/src/calendar.ts
// Pure URL builders for the email's "add to calendar" + "share" CTAs.
import { editionOrdinal } from './format';

interface EditionLike {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  venue: string;
}

// REPLAY's times are stored as India Standard Time (UTC+05:30). Calendar
// providers need UTC basic format, including when a time crosses UTC midnight.
export function toUtcBasic(dateIso: string, localTime: string): string {
  const dateMatch = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = localTime.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!dateMatch || !timeMatch) throw new Error('invalid calendar date or time');
  const utc = new Date(Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]) - 5,
    Number(timeMatch[2]) - 30,
  ));
  return utc.toISOString().replace(/[-:]/g, '').replace(/\.000/, '');
}

function displayName(edition: EditionLike): string {
  const ord = editionOrdinal(edition.slug);
  return ord ? `REPLAY ${ord}` : 'REPLAY';
}

export function buildGoogleCalendarUrl(edition: EditionLike): string {
  const dates = `${toUtcBasic(edition.start_date, edition.daily_start_time)}/${toUtcBasic(edition.end_date, edition.daily_end_time)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: displayName(edition),
    dates,
    details: `Bangalore board-game convention. Tickets + schedule: https://replaycon.in`,
    location: edition.venue,
  });
  // URLSearchParams encodes spaces as +; Google Calendar accepts %20 too,
  // but we use %20 for consistency with the tests + cleaner appearance.
  return `https://calendar.google.com/calendar/render?${params.toString().replace(/\+/g, '%20')}`;
}

export function buildWhatsAppShareUrl(edition: EditionLike): string {
  const text = `Going to ${displayName(edition)} — Bangalore's board-game weekend. Grab a pass at https://replaycon.in`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
