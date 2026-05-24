// worker/src/calendar.ts
// Pure URL builders for the email's "add to calendar" + "share" CTAs.
import { editionOrdinal } from './format';

interface EditionLike {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
}

// Convention runs 10:00–19:00 IST. IST is UTC+05:30, so:
//   10:00 IST → 04:30 UTC, 19:00 IST → 13:30 UTC.
function toUtcBasic(dateIso: string, time: 'start' | 'end'): string {
  const t = time === 'start' ? '043000Z' : '133000Z';
  return `${dateIso.replace(/-/g, '')}T${t}`;
}

function displayName(edition: EditionLike): string {
  const ord = editionOrdinal(edition.slug);
  return ord ? `REPLAY ${ord}` : 'REPLAY';
}

export function buildGoogleCalendarUrl(edition: EditionLike): string {
  const dates = `${toUtcBasic(edition.start_date, 'start')}/${toUtcBasic(edition.end_date, 'end')}`;
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
