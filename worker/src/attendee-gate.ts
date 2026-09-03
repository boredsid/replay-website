// Whether an attendee has earned the paired half of the app right now.
//
// Extracted so booking a session and borrowing a game ask the *same* question.
// Two copies of this rule would eventually disagree, and the disagreement would
// surface as one screen offering something another screen refuses — in front of
// somebody, at a desk, on the day.
import type { SupabaseClient } from '@supabase/supabase-js';
import { pairingGateDay } from './event-day';
import type { CheckInEvent, EventDay } from './admin/check-in-state';

/**
 * During the event: they must have arrived today, so a held seat or a borrowed
 * box means someone actually in the building. Outside it: any day their ticket
 * covers, which is what lets the whole flow be rehearsed rather than first run
 * at the door.
 *
 * Returns the qualifying day, or null when they have not earned it.
 */
export async function attendeeGateDay(
  sb: SupabaseClient,
  attendeeId: string,
  edition: { start_date: string; end_date: string },
): Promise<EventDay | null> {
  const [attendee, events] = await Promise.all([
    sb.from('attendees').select('registration_id').eq('id', attendeeId).maybeSingle(),
    sb.from('check_in_events')
      .select('id, day, kind, voids_event_id, occurred_at')
      .eq('attendee_id', attendeeId),
  ]);
  if (attendee.error || events.error || !attendee.data) return null;

  const reg = await sb
    .from('registrations')
    .select('days')
    .eq('id', (attendee.data as { registration_id: string }).registration_id)
    .maybeSingle();
  if (reg.error) return null;

  const ticketDays = (reg.data as { days: EventDay[] } | null)?.days ?? [];
  return pairingGateDay(edition, ticketDays, (events.data ?? []) as CheckInEvent[]);
}
