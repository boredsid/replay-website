// worker/src/ics.ts
// GET /api/ics/:slug.ics — returns an iCalendar VEVENT for the edition.
// Apple Mail + Outlook consume this when opening the email's calendar CTA.
import type { Env } from './index';
import { serviceClient } from './supabase';
import { editionOrdinal } from './format';
import { toUtcBasic } from './calendar';

interface EditionRow {
  slug: string;
  start_date: string;
  end_date: string;
  venue: string;
  is_published: boolean;
}

// iCalendar text values escape commas, semicolons, and backslashes.
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n');
}

function nowUtcBasic(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export async function handleIcsRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/ics\/([a-z0-9-]+)\.ics$/);
  if (!match) return new Response('not found', { status: 404 });
  const slug = match[1];

  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('editions')
    .select('slug, start_date, end_date, venue, is_published')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  if (error) return new Response('error', { status: 500 });
  const edition = data as EditionRow | null;
  if (!edition) return new Response('not found', { status: 404 });

  const ord = editionOrdinal(edition.slug);
  const summary = ord ? `REPLAY ${ord}` : 'REPLAY';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//replaycon.in//REPLAY//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:replay-${edition.slug}@replaycon.in`,
    `DTSTAMP:${nowUtcBasic()}`,
    `DTSTART:${toUtcBasic(edition.start_date, 'start')}`,
    `DTEND:${toUtcBasic(edition.end_date, 'end')}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${escapeIcsText(edition.venue)}`,
    `DESCRIPTION:${escapeIcsText('Bangalore board-game convention. Tickets + schedule: https://replaycon.in')}`,
    'URL:https://replaycon.in',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const body = lines.join('\r\n') + '\r\n';

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
