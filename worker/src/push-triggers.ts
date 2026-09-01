// The two notifications nobody explicitly asks for: an urgent notice, and a
// reminder that something they booked is about to start.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyAttendees, type FanOutResult } from './push-send';

/** How long before a session starts to remind the people who booked it. */
export const REMINDER_LEAD_MINUTES = 15;

/** How far past the lead time a reminder is still worth sending. */
const REMINDER_WINDOW_MINUTES = 10;

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

interface DueSignup {
  id: string;
  attendee_id: string;
  schedule_item_id: string;
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
    .select('id, title, start_time, location')
    .eq('edition_id', currentEdition.id)
    .eq('day', today)
    .eq('public_status', 'published')
    .not('start_time', 'is', null);
  if (sessions.error) return { reminded: 0, sessions: 0 };

  const due = ((sessions.data ?? []) as Array<{ id: string; title: string; start_time: string; location: string | null }>)
    .filter((item) => {
      const [h, m] = item.start_time.split(':').map(Number);
      const startsIn = (h * 60 + m) - nowMinutes;
      // A window rather than an exact minute: cron ticks are not punctual, and a
      // reminder five minutes late still beats none.
      return startsIn <= REMINDER_LEAD_MINUTES && startsIn > REMINDER_LEAD_MINUTES - REMINDER_WINDOW_MINUTES;
    });

  let reminded = 0;
  for (const session of due) {
    const signups = await sb
      .from('session_signups')
      .select('id, attendee_id, schedule_item_id')
      .eq('schedule_item_id', session.id)
      .eq('status', 'confirmed')
      .is('reminded_at', null);
    if (signups.error) continue;

    const rows = (signups.data ?? []) as DueSignup[];
    if (rows.length === 0) continue;

    const result = await notifyAttendees(env, sb, rows.map((r) => r.attendee_id), 'reminders', {
      title: `${session.title} starts soon`,
      body: session.location
        ? `In about ${REMINDER_LEAD_MINUTES} minutes, at ${session.location}.`
        : `In about ${REMINDER_LEAD_MINUTES} minutes.`,
      url: '#my-day',
      tag: `reminder-${session.id}`,
    });

    // Stamped whether or not anybody was actually reachable: the point is that
    // this session has had its reminder, not that every device received it.
    await sb
      .from('session_signups')
      .update({ reminded_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id));

    reminded += result.sent;
  }

  return { reminded, sessions: due.length };
}
