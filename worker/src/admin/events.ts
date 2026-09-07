// The events board: every bookable session at once, and who is in each.
//
// Rosters answered one session at a time, which is the wrong shape for the two
// questions people actually stand there asking. "How is the day going" meant
// opening four rosters in turn, and "what has this person booked" had no answer
// at all — a scanned pass says who somebody is and what they have borrowed, and
// nothing about the seats they hold.
//
// So this returns the whole edition in one payload: sessions with their
// confirmed lists and queues. The screen derives the overview, the per-person
// view and the export from that one read, which is also why there is no
// separate "what has this person booked" endpoint — it is a filter, not a query.
//
// Who may do what here is unusual and deliberate. `/api/admin/events` is in
// `READABLE_BY_ALL`, so every member of staff can read it; it has no entry in
// `RULES`, so writing is admin and basic_admin only. A desk role that needs to
// change a booking still has the session roster it already owns.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import { adminJson } from './auth';
import { getCurrentEdition, getEditionById } from '../editions';
import { maskPhone, seatLabel } from './check-in';
import { createSignup, removeSignup } from './session-roster';

/**
 * Enough for an edition many times the size of this one.
 *
 * Stated rather than left to PostgREST's default of 1000, because silently
 * returning the first thousand of something staff are counting from is worse
 * than refusing.
 */
const MAX_SIGNUPS = 10000;

interface SessionRow {
  id: string;
  title: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  host_name: string | null;
  kind: string;
  section: string;
  capacity: number | null;
  signup_mode: string;
  public_status: string;
  display_order: number;
}

interface SignupRow {
  schedule_item_id: string;
  attendee_id: string;
  status: 'confirmed' | 'waitlisted';
  signed_up_at: string;
  promoted_at: string | null;
}

interface AttendeeRow {
  id: string;
  seat_index: number;
  display_name: string | null;
  phone: string | null;
}

/**
 * Every bookable session in an edition, with its confirmed list and its queue.
 *
 * Three queries whatever the size of the programme: the sessions, their
 * signups, and the people those signups name. The alternative — a roster call
 * per session — is the thing this page exists to replace.
 */
export async function handleEventsOverview(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const requested = new URL(req.url).searchParams.get('edition_id')?.trim() ?? '';
  const edition = requested ? await getEditionById(env, requested) : await getCurrentEdition(env);
  if (!edition) {
    return adminJson({ error: requested ? 'edition_not_found' : 'no_current_edition' }, requested ? 404 : 503, origin);
  }

  const items = await sb
    .from('schedule_items')
    .select('id, title, day, start_time, end_time, is_all_day, location, host_name, kind, section, capacity, signup_mode, public_status, display_order')
    .eq('edition_id', edition.id)
    // Only sessions people can book. An all-day open-play table has no roster
    // to show, and listing it would bury the four things that do.
    .eq('signup_mode', 'app')
    .order('day', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
    .order('display_order', { ascending: true });
  if (items.error) return adminJson({ error: 'query_failed' }, 500, origin);
  const sessions = (items.data ?? []) as SessionRow[];

  // Ordered by sign-up time across the whole edition, so queue position within
  // a session is just the order these arrive in — the same derivation
  // `handleSessionRoster` makes. Position is never stored; two places reading
  // it two ways is how they would come to disagree.
  const signups = await sb
    .from('session_signups')
    .select('schedule_item_id, attendee_id, status, signed_up_at, promoted_at')
    .eq('edition_id', edition.id)
    .neq('status', 'cancelled')
    .order('signed_up_at', { ascending: true })
    .limit(MAX_SIGNUPS);
  if (signups.error) return adminJson({ error: 'query_failed' }, 500, origin);
  const rows = (signups.data ?? []) as SignupRow[];

  let people = new Map<string, AttendeeRow>();
  if (rows.length > 0) {
    const attendees = await sb
      .from('attendees')
      .select('id, seat_index, display_name, phone')
      .in('id', [...new Set(rows.map((row) => row.attendee_id))]);
    if (attendees.error) return adminJson({ error: 'query_failed' }, 500, origin);
    people = new Map(((attendees.data ?? []) as AttendeeRow[]).map((a) => [a.id, a]));
  }

  const shape = (row: SignupRow) => {
    const person = people.get(row.attendee_id);
    return {
      attendee_id: row.attendee_id,
      name: person ? seatLabel(person.display_name, person.seat_index) : 'Unknown',
      // Masked, as everywhere a list of people is shown: enough to tell two
      // attendees apart, far less to lose than a sheet of whole numbers.
      phone_masked: person ? maskPhone(person.phone) : null,
      signed_up_at: row.signed_up_at,
      promoted: row.promoted_at !== null,
    };
  };

  const byItem = new Map<string, SignupRow[]>();
  for (const row of rows) {
    byItem.set(row.schedule_item_id, [...(byItem.get(row.schedule_item_id) ?? []), row]);
  }

  return adminJson({
    edition: { id: edition.id, slug: edition.slug, name: edition.name },
    sessions: sessions.map((session) => {
      const mine = byItem.get(session.id) ?? [];
      const confirmed = mine.filter((row) => row.status === 'confirmed').map(shape);
      const waitlisted = mine.filter((row) => row.status === 'waitlisted').map(shape);
      return {
        id: session.id,
        title: session.title,
        day: session.day,
        start_time: session.start_time,
        end_time: session.end_time,
        is_all_day: session.is_all_day,
        location: session.location,
        host_name: session.host_name,
        kind: session.kind,
        section: session.section,
        capacity: session.capacity,
        public_status: session.public_status,
        seats_remaining: session.capacity === null ? null : Math.max(0, session.capacity - confirmed.length),
        confirmed,
        waitlisted,
      };
    }),
  }, 200, origin);
}

/** The two ids every write here takes, from a body that may not be JSON at all. */
async function readBooking(req: Request): Promise<{ schedule_item_id: string; attendee_id: unknown }> {
  try {
    const body = await req.json<{ schedule_item_id?: string; attendee_id?: string }>();
    return { schedule_item_id: String(body?.schedule_item_id ?? ''), attendee_id: body?.attendee_id };
  } catch {
    return { schedule_item_id: '', attendee_id: null };
  }
}

/**
 * Books somebody into a session from the events board.
 *
 * Runs the same shared function the roster does, so capacity, the waitlist and
 * the promotion notification behave identically whichever screen was used. The
 * audit records which one it was.
 */
export async function handleEventsSignupCreate(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const { schedule_item_id, attendee_id } = await readBooking(req);
  const result = await createSignup(sb, schedule_item_id, attendee_id, actorEmail, 'events');
  if (!result.ok) return adminJson({ error: result.error }, result.status, origin);
  return adminJson(result.data, 200, origin);
}

/** Takes somebody out of a session, promoting whoever has waited longest. */
export async function handleEventsSignupRemove(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const { schedule_item_id, attendee_id } = await readBooking(req);
  const result = await removeSignup(env, ctx, sb, schedule_item_id, attendee_id, actorEmail, 'events');
  if (!result.ok) return adminJson({ error: result.error }, result.status, origin);
  return adminJson(result.data, 200, origin);
}
