// What the attendee actually holds: which days, and whether they are in yet.
//
// The ID tab could show none of this before — a name and a QR, which answers
// "who are you" and nothing else. The questions people actually arrive with are
// "does my ticket cover Sunday" and "am I checked in", and both were only
// answerable by queueing at the desk to ask.
//
// Read fresh rather than from the paired device's stored copy. The desk can
// rename a seat after pairing, and a pass showing "Guest 2" to someone the desk
// has since named is worse than useless at a door.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { getCurrentEdition } from './editions';
import { authenticateDevice } from './attendee-auth';
import { currentState, hasArrivedOn, type CheckInEvent, type EventDay } from './admin/check-in-state';

const DAYS: readonly EventDay[] = ['day1', 'day2'];

export interface PassDay {
  day: EventDay;
  /** The calendar date, so the app can say "Sat, 12 Sept" without guessing. */
  date: string;
  /** Whether the ticket covers this day at all. */
  covered: boolean;
  /** Arrived at some point today, even if they have since stepped out. */
  arrived: boolean;
  /** Inside right now. Null means they have not arrived at all. */
  present: 'in' | 'out' | null;
}

export async function handleMyPass(req: Request, env: Env): Promise<Response> {
  const sb: SupabaseClient = serviceClient(env);

  const auth = await authenticateDevice(req, sb);
  if (!auth.ok) {
    // 401 makes the app throw the token away and send them back through setup.
    // A query that merely failed must never do that.
    return jsonResponse({ error: auth.error }, auth.error === 'query_failed' ? 503 : 401);
  }

  const edition = await getCurrentEdition(env);
  if (!edition) return jsonResponse({ error: 'event_unavailable' }, 503);

  const [attendee, events] = await Promise.all([
    sb.from('attendees')
      .select('registration_id, display_name, seat_index')
      .eq('id', auth.identity.attendee_id)
      .maybeSingle(),
    sb.from('check_in_events')
      .select('id, day, kind, voids_event_id, occurred_at')
      .eq('attendee_id', auth.identity.attendee_id),
  ]);
  if (attendee.error || events.error || !attendee.data) return jsonResponse({ error: 'query_failed' }, 500);

  const person = attendee.data as {
    registration_id: string; display_name: string | null; seat_index: number;
  };

  const registration = await sb
    .from('registrations')
    .select('days, pass_type')
    .eq('id', person.registration_id)
    .maybeSingle();
  if (registration.error) return jsonResponse({ error: 'query_failed' }, 500);

  const ticket = registration.data as { days: EventDay[]; pass_type: string } | null;
  const covered = new Set(ticket?.days ?? []);
  const history = (events.data ?? []) as CheckInEvent[];
  const presence = currentState(history);

  // Both days always, never only the covered ones. Someone holding a one-day
  // ticket needs to see that Sunday exists and is not theirs — that is the
  // question the desk gets asked, and answering it here is the point.
  const days: PassDay[] = DAYS.map((day) => ({
    day,
    date: day === 'day1' ? edition.start_date : edition.end_date,
    covered: covered.has(day),
    arrived: hasArrivedOn(history, day),
    present: presence[day],
  }));

  return jsonResponse({
    display_name: person.display_name,
    seat_index: person.seat_index,
    pass_type: ticket?.pass_type ?? null,
    days,
  });
}
