// Who is booked into a session, and the two things staff can do about it.
//
// The desk sign-up matters more than it looks: without it, declining the app
// would mean being shut out of the programme entirely, which turns a convenience
// into a requirement. It runs the same locking function the app does, so the
// capacity and waitlist rules cannot diverge between the two paths.
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';
import { getCurrentEdition } from '../editions';
import { maskPhone, normalizePhone, seatLabel } from './check-in';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SignupRow {
  attendee_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  signed_up_at: string;
  promoted_at: string | null;
}

interface AttendeeRow {
  id: string;
  seat_index: number;
  display_name: string | null;
  phone: string | null;
}

/** Confirmed first, then the queue in the order it formed. */
export async function handleSessionRoster(
  _req: Request,
  sb: SupabaseClient,
  scheduleItemId: string,
  origin: string,
): Promise<Response> {
  if (!UUID.test(scheduleItemId)) return adminJson({ error: 'invalid_session_id' }, 400, origin);

  const item = await sb
    .from('schedule_items')
    .select('id, title, capacity, signup_mode, day, start_time')
    .eq('id', scheduleItemId)
    .maybeSingle();
  if (item.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!item.data) return adminJson({ error: 'session_not_found' }, 404, origin);
  const session = item.data as {
    id: string; title: string; capacity: number | null;
    signup_mode: string; day: string; start_time: string | null;
  };

  const signups = await sb
    .from('session_signups')
    .select('attendee_id, status, signed_up_at, promoted_at')
    .eq('schedule_item_id', scheduleItemId)
    .neq('status', 'cancelled')
    .order('signed_up_at', { ascending: true });
  if (signups.error) return adminJson({ error: 'query_failed' }, 500, origin);
  const rows = (signups.data ?? []) as SignupRow[];

  let people = new Map<string, AttendeeRow>();
  if (rows.length > 0) {
    const attendees = await sb
      .from('attendees')
      .select('id, seat_index, display_name, phone')
      .in('id', rows.map((r) => r.attendee_id));
    if (attendees.error) return adminJson({ error: 'query_failed' }, 500, origin);
    people = new Map(((attendees.data ?? []) as AttendeeRow[]).map((a) => [a.id, a]));
  }

  const shape = (row: SignupRow) => {
    const person = people.get(row.attendee_id);
    return {
      attendee_id: row.attendee_id,
      name: person ? seatLabel(person.display_name, person.seat_index) : 'Unknown',
      // Masked, as everywhere else: a host reading a list does not need whole
      // phone numbers, only enough to tell two people apart.
      phone_masked: person ? maskPhone(person.phone) : null,
      signed_up_at: row.signed_up_at,
      promoted: row.promoted_at !== null,
    };
  };

  const confirmed = rows.filter((r) => r.status === 'confirmed').map(shape);
  const waitlisted = rows.filter((r) => r.status === 'waitlisted').map(shape);

  return adminJson({
    session: {
      id: session.id,
      title: session.title,
      day: session.day,
      start_time: session.start_time,
      capacity: session.capacity,
      signup_mode: session.signup_mode,
      seats_remaining: session.capacity === null ? null : Math.max(0, session.capacity - confirmed.length),
    },
    confirmed,
    waitlisted,
  }, 200, origin);
}

/**
 * Signs someone up from the desk.
 *
 * Same function the app calls, so an attendee who declines the app gets exactly
 * the same capacity and waitlist treatment — the only difference is who pressed
 * the button, which the audit records.
 */
export async function handleSessionSignupCreate(
  req: Request,
  sb: SupabaseClient,
  scheduleItemId: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  if (!UUID.test(scheduleItemId)) return adminJson({ error: 'invalid_session_id' }, 400, origin);

  let attendeeId: string;
  try {
    const body = await req.json<{ attendee_id?: string }>();
    if (!UUID.test(String(body?.attendee_id ?? ''))) throw new Error('invalid_attendee_id');
    attendeeId = body.attendee_id!;
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const { data, error } = await sb.rpc('sign_up_for_session', {
    p_attendee_id: attendeeId,
    p_schedule_item_id: scheduleItemId,
  });
  if (error) {
    if (error.message?.includes('session_not_bookable')) {
      return adminJson({ error: 'session_not_bookable' }, 409, origin);
    }
    return adminJson({ error: 'signup_failed' }, 500, origin);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    { status: string; queue_position: number } | undefined;

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'session_signup.desk',
    target_table: 'session_signups',
    target_id: scheduleItemId,
    diff: { attendee_id: attendeeId, status: row?.status },
  });

  return adminJson({ status: row?.status, queue_position: row?.queue_position ?? 0 }, 200, origin);
}

/**
 * Removes someone from a session, promoting whoever has waited longest.
 *
 * Used when a host knows an attendee will not make it. The promotion is a side
 * effect of the same function the app's cancel uses, so a seat freed here reaches
 * the queue exactly as one freed from a phone does.
 */
export async function handleSessionSignupRemove(
  req: Request,
  sb: SupabaseClient,
  scheduleItemId: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  if (!UUID.test(scheduleItemId)) return adminJson({ error: 'invalid_session_id' }, 400, origin);

  let attendeeId: string;
  try {
    const body = await req.json<{ attendee_id?: string }>();
    if (!UUID.test(String(body?.attendee_id ?? ''))) throw new Error('invalid_attendee_id');
    attendeeId = body.attendee_id!;
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const { data, error } = await sb.rpc('cancel_session_signup', {
    p_attendee_id: attendeeId,
    p_schedule_item_id: scheduleItemId,
  });
  if (error) return adminJson({ error: 'remove_failed' }, 500, origin);

  const row = (Array.isArray(data) ? data[0] : data) as
    { cancelled: boolean; promoted_attendee_id: string | null } | undefined;

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'session_signup.remove',
    target_table: 'session_signups',
    target_id: scheduleItemId,
    diff: { attendee_id: attendeeId, promoted: row?.promoted_attendee_id ?? null },
  });

  return adminJson({
    removed: row?.cancelled ?? false,
    // Staff do want to know this one — somebody just got a seat and may need
    // telling, since there is no push notification yet.
    promoted_attendee_id: row?.promoted_attendee_id ?? null,
  }, 200, origin);
}

/** Finds an attendee to add, by phone or name, within the current edition. */
export async function handleSessionAttendeeSearch(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const raw = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (raw.length < 2) return adminJson({ attendees: [] }, 200, origin);

  const edition = await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_current_edition' }, 503, origin);

  const digits = normalizePhone(raw);
  const query = sb
    .from('attendees')
    .select('id, seat_index, display_name, phone')
    .eq('edition_id', edition.id)
    .limit(10);

  const { data, error } = digits.length >= 4
    ? await query.like('phone', `%${digits}%`)
    : await query.ilike('display_name', `${raw}%`);
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);

  return adminJson({
    attendees: ((data ?? []) as AttendeeRow[]).map((a) => ({
      attendee_id: a.id,
      name: seatLabel(a.display_name, a.seat_index),
      phone_masked: maskPhone(a.phone),
    })),
  }, 200, origin);
}
