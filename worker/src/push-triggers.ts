// The two notifications nobody explicitly asks for: an urgent notice, and a
// reminder that something they booked or starred is about to start.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyAttendees, type FanOutResult } from './push-send';

/** How long before a session starts to remind the people counting on it. */
export const REMINDER_LEAD_MINUTES = 15;

/** How far past the lead time a reminder is still worth sending. */
const REMINDER_WINDOW_MINUTES = 10;

/**
 * Longest session that still has a start worth being reminded about.
 *
 * `is_all_day` does not catch what it sounds like it catches. Board Games Open
 * Tables, Jigsaw Puzzles and TCG all run 9-to-9 or 10-to-8 with real start and
 * end times and `is_all_day = false`, because the schedule wants to print their
 * hours. Buzzing someone at 08:45 that a twelve-hour drop-in table "starts
 * soon" is the kind of notification that gets the whole channel switched off.
 *
 * Four hours is where the programme's real slots end: every RPG block is four,
 * tournaments and workshops are two or three, and the only things above it are
 * stations you wander into. Verified against the 2026 programme.
 */
const MAX_REMINDABLE_HOURS = 4;

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  severity: string;
  audience: string;
}

/**
 * Notifies everyone about an urgent or incident notice.
 *
 * Routine updates are deliberately excluded. A channel that buzzes for ordinary
 * news gets turned off, and then it is not there for the notice that matters.
 */
export async function notifyAnnouncement(
  env: Env,
  sb: SupabaseClient,
  announcement: AnnouncementRow,
  editionId: string,
): Promise<FanOutResult | null> {
  if (announcement.severity !== 'urgent' && announcement.severity !== 'incident') return null;

  const { data, error } = await sb
    .from('attendees')
    .select('id')
    .eq('edition_id', editionId);
  if (error) return null;

  const attendeeIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  return notifyAttendees(env, sb, attendeeIds, 'announcements', {
    title: announcement.severity === 'incident' ? `Important: ${announcement.title}` : announcement.title,
    body: announcement.body.slice(0, 200),
    url: '#now',
    // One tag per announcement, so an edited notice replaces its earlier self on
    // the lock screen instead of appearing twice.
    tag: `announcement-${announcement.id}`,
  });
}

interface DueRow {
  id: string;
  attendee_id: string;
}

/**
 * Reminds people about sessions starting shortly.
 *
 * Runs from a cron trigger, and cron delivery is at-least-once — a retry after a
 * partial run must not remind everybody a second time. The `reminded_at` stamp is
 * what makes that safe, and it is written per row immediately after sending
 * rather than in a batch at the end, so an interrupted run only loses the
 * reminders it had not sent yet.
 */
/** Whether this is a session with a start to miss, rather than a drop-in. */
export function runsShortEnoughToStart(startTime: string, endTime: string | null): boolean {
  // No end time means nothing to judge it by, and a session with a start is
  // worth a reminder until something says otherwise.
  if (!endTime) return true;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm) <= MAX_REMINDABLE_HOURS * 60;
}

export async function sendSessionReminders(
  env: Env,
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<{ reminded: number; sessions: number }> {
  const edition = await sb
    .from('editions')
    .select('id, start_date, end_date')
    .eq('is_current', true)
    .maybeSingle();
  if (edition.error || !edition.data) return { reminded: 0, sessions: 0 };
  const currentEdition = edition.data as { id: string; start_date: string; end_date: string };

  // Everything is stored and reasoned about in IST, which is where the event is.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  if (today !== currentEdition.start_date && today !== currentEdition.end_date) {
    return { reminded: 0, sessions: 0 };
  }

  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  const [hours, minutes] = clock.split(':').map(Number);
  const nowMinutes = hours * 60 + minutes;

  const sessions = await sb
    .from('schedule_items')
    .select('id, title, start_time, end_time, location')
    .eq('edition_id', currentEdition.id)
    .eq('day', today)
    .eq('public_status', 'published')
    // An all-day activity has no start to be fifteen minutes away from, and a
    // reminder for one would arrive at whatever time the row happens to carry.
    .eq('is_all_day', false)
    .not('start_time', 'is', null);
  if (sessions.error) return { reminded: 0, sessions: 0 };

  const due = ((sessions.data ?? []) as Array<{
    id: string; title: string; start_time: string; end_time: string | null; location: string | null;
  }>)
    .filter((item) => {
      const [h, m] = item.start_time.split(':').map(Number);
      const startsIn = (h * 60 + m) - nowMinutes;
      // A window rather than an exact minute: cron ticks are not punctual, and a
      // reminder five minutes late still beats none.
      if (startsIn > REMINDER_LEAD_MINUTES || startsIn <= REMINDER_LEAD_MINUTES - REMINDER_WINDOW_MINUTES) {
        return false;
      }
      return runsShortEnoughToStart(item.start_time, item.end_time);
    });

  let reminded = 0;
  for (const session of due) {
    // Two ways to mean "I intend to be there": a booked seat, and a star. Both
    // deserve the nudge, and somebody who did both deserves exactly one.
    const [signups, stars] = await Promise.all([
      sb.from('session_signups')
        .select('id, attendee_id')
        .eq('schedule_item_id', session.id)
        .eq('status', 'confirmed')
        .is('reminded_at', null),
      sb.from('saved_items')
        .select('id, attendee_id')
        .eq('schedule_item_id', session.id)
        .is('reminded_at', null),
    ]);
    if (signups.error || stars.error) continue;

    const bookedRows = (signups.data ?? []) as DueRow[];
    const starredRows = (stars.data ?? []) as DueRow[];
    if (bookedRows.length === 0 && starredRows.length === 0) continue;

    const attendeeIds = [...new Set([...bookedRows, ...starredRows].map((r) => r.attendee_id))];

    const result = await notifyAttendees(env, sb, attendeeIds, 'reminders', {
      title: `${session.title} starts soon`,
      body: session.location
        ? `In about ${REMINDER_LEAD_MINUTES} minutes, at ${session.location}.`
        : `In about ${REMINDER_LEAD_MINUTES} minutes.`,
      url: '#my-day',
      tag: `reminder-${session.id}`,
    });

    // Stamped whether or not anybody was actually reachable: the point is that
    // this session has had its reminder, not that every device received it.
    // Both tables, or the next tick reminds the half that was not stamped.
    const stamp = new Date().toISOString();
    await Promise.all([
      bookedRows.length > 0
        ? sb.from('session_signups').update({ reminded_at: stamp }).in('id', bookedRows.map((r) => r.id))
        : Promise.resolve(),
      starredRows.length > 0
        ? sb.from('saved_items').update({ reminded_at: stamp }).in('id', starredRows.map((r) => r.id))
        : Promise.resolve(),
    ]);

    reminded += result.sent;
  }

  return { reminded, sessions: due.length };
}
