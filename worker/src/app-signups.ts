// Session sign-ups from the attendee app.
//
// Every route here is authorised by a device token and scoped to that one
// attendee. There is no way to read or touch anybody else's bookings, which is
// what keeps a stolen token a nuisance rather than a breach.
//
// Capacity and clashes are not enforced here. Both are enforced by
// `sign_up_for_session`, which locks the schedule row and the attendee and then
// counts inside the transaction — doing either in the Worker would race the
// moment two people tap the last seat, or one person taps two overlapping
// sessions, together.
//
// What *is* enforced here is the check-in gate: which day somebody has turned
// up for is a question about the app's half of the world, and the desk signs
// people up through the same database function without it.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { getCurrentEdition } from './editions';
import { authenticateDevice, type DeviceIdentity } from './attendee-auth';
import { attendeeBookableDays } from './attendee-gate';
import { dateForDay } from './event-day';
import { notifyInBackground } from './push-send';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maps a database exception onto something the app can act on. */
const SIGNUP_ERRORS: Record<string, { error: string; status: number }> = {
  session_not_found: { error: 'session_not_found', status: 404 },
  session_not_bookable: { error: 'session_not_bookable', status: 409 },
  session_not_published: { error: 'session_not_bookable', status: 409 },
  attendee_not_found: { error: 'attendee_not_found', status: 404 },
  wrong_edition: { error: 'wrong_edition', status: 409 },
  session_clash: { error: 'session_clash', status: 409 },
};

async function requireDevice(
  req: Request,
  sb: SupabaseClient,
): Promise<DeviceIdentity | Response> {
  const auth = await authenticateDevice(req, sb);
  if (auth.ok) return auth.identity;
  // 401 tells the app to clear its stored token and start the wizard again;
  // 503 does not, which is why a query failure must not masquerade as one.
  const status = auth.error === 'query_failed' ? 503 : 401;
  return jsonResponse({ error: auth.error }, status);
}

/**
 * The dates this attendee may book sessions on, as the schedule spells them.
 *
 * The rule itself lives in `attendeeBookableDays`, shared with game-library
 * borrowing, so the two cannot drift into disagreeing about who is allowed
 * what. Returned as calendar dates because that is what `schedule_items.day`
 * holds, and translating in one place beats translating at every comparison.
 */
async function bookableDates(
  sb: SupabaseClient,
  attendeeId: string,
  edition: { start_date: string; end_date: string },
): Promise<string[]> {
  const days = await attendeeBookableDays(sb, attendeeId, edition);
  return days.map((day) => dateForDay(edition, day));
}

/** Everything this attendee currently holds, confirmed or queued. */
export async function handleMySignups(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  const { data, error } = await sb
    .from('session_signups')
    .select('schedule_item_id, status, signed_up_at, promoted_at')
    .eq('attendee_id', identity.attendee_id)
    .neq('status', 'cancelled');
  if (error) return jsonResponse({ error: 'query_failed' }, 500);

  const rows = (data ?? []) as Array<{
    schedule_item_id: string; status: string; signed_up_at: string; promoted_at: string | null;
  }>;

  // Queue position travels with the booking so the card can state it in place,
  // rather than the app having to remember what a one-off response said.
  const waiting = rows.filter((row) => row.status === 'waitlisted');
  const positions = new Map<string, number>();
  if (waiting.length > 0) {
    const queues = await sb
      .from('session_signups')
      .select('schedule_item_id, signed_up_at')
      .in('schedule_item_id', waiting.map((row) => row.schedule_item_id))
      .eq('status', 'waitlisted');
    if (!queues.error) {
      const all = (queues.data ?? []) as Array<{ schedule_item_id: string; signed_up_at: string }>;
      for (const row of waiting) {
        positions.set(row.schedule_item_id, all.filter(
          (other) => other.schedule_item_id === row.schedule_item_id
            && other.signed_up_at <= row.signed_up_at,
        ).length);
      }
    }
  }

  // Sent alongside the bookings so the schedule can grey out a day the desk has
  // not let them into yet, instead of offering a button that will be refused.
  // Null means the answer is unknown right now — the app must not invent a
  // restriction out of a failed lookup, and the server refuses regardless.
  const edition = await getCurrentEdition(env);
  const dates = edition ? await bookableDates(sb, identity.attendee_id, edition) : null;

  return jsonResponse({
    signups: rows.map((row) => ({ ...row, queue_position: positions.get(row.schedule_item_id) ?? 0 })),
    bookable_dates: dates,
  });
}

export async function handleSignUp(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  let scheduleItemId: string;
  try {
    const body = await req.json<{ schedule_item_id?: string }>();
    if (!UUID.test(String(body?.schedule_item_id ?? ''))) throw new Error('invalid_schedule_item_id');
    scheduleItemId = body.schedule_item_id!;
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 400);
  }

  const edition = await getCurrentEdition(env);
  if (!edition) return jsonResponse({ error: 'event_unavailable' }, 503);

  // Checked at the moment of booking rather than at pairing: a device paired on
  // day 1 must not hold day 2 seats until that person actually turns up.
  const allowed = await bookableDates(sb, identity.attendee_id, edition);
  if (allowed.length === 0) return jsonResponse({ error: 'not_checked_in' }, 409);

  // Which day the session falls on decides whether this particular check-in
  // covers it. Read here rather than inside `sign_up_for_session`, because the
  // desk signs people up through that same function and is deliberately allowed
  // to book somebody who has not arrived yet.
  const item = await sb
    .from('schedule_items')
    .select('day')
    .eq('id', scheduleItemId)
    .maybeSingle();
  if (item.error) return jsonResponse({ error: 'query_failed' }, 500);
  if (!item.data) return jsonResponse({ error: 'session_not_found' }, 404);

  const day = (item.data as { day: string }).day;
  if (!allowed.includes(day)) return jsonResponse({ error: 'wrong_day', day }, 409);

  const { data, error } = await sb.rpc('sign_up_for_session', {
    p_attendee_id: identity.attendee_id,
    p_schedule_item_id: scheduleItemId,
  });

  if (error) {
    const known = Object.keys(SIGNUP_ERRORS).find((key) => error.message?.includes(key));
    if (known) return jsonResponse(SIGNUP_ERRORS[known], SIGNUP_ERRORS[known].status);
    return jsonResponse({ error: 'signup_failed' }, 500);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    { status: string; queue_position: number } | undefined;
  if (!row) return jsonResponse({ error: 'signup_failed' }, 500);

  return jsonResponse({ status: row.status, queue_position: row.queue_position });
}

/**
 * Give up a seat or leave the queue.
 *
 * Deliberately not gated on having checked in: someone should always be able to
 * release a seat they cannot use, and refusing that would keep the seat out of
 * circulation for whoever is waiting.
 */
export async function handleCancelSignup(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  scheduleItemId: string,
): Promise<Response> {
  if (!UUID.test(scheduleItemId)) return jsonResponse({ error: 'invalid_schedule_item_id' }, 400);

  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  const { data, error } = await sb.rpc('cancel_session_signup', {
    p_attendee_id: identity.attendee_id,
    p_schedule_item_id: scheduleItemId,
  });
  if (error) return jsonResponse({ error: 'cancel_failed' }, 500);

  const row = (Array.isArray(data) ? data[0] : data) as
    { cancelled: boolean; promoted_attendee_id: string | null } | undefined;

  // Giving up a seat is the moment somebody else gets one. Telling them is the
  // reason push exists, and it happens in the background so a slow push service
  // cannot make cancelling feel broken.
  if (row?.promoted_attendee_id) {
    const session = await sb
      .from('schedule_items')
      .select('title')
      .eq('id', scheduleItemId)
      .maybeSingle();
    const title = (session.data as { title: string } | null)?.title ?? 'a session';
    notifyInBackground(ctx, env, sb, [row.promoted_attendee_id], 'waitlist', {
      title: 'A seat opened up',
      body: `You are in for ${title}.`,
      url: '#my-day',
      tag: `signup-${scheduleItemId}`,
    });
  }

  // Whether somebody else was promoted is not this attendee's business, so only
  // the fact of their own cancellation comes back.
  return jsonResponse({ cancelled: row?.cancelled ?? false });
}
