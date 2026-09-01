// Session sign-ups from the attendee app.
//
// Every route here is authorised by a device token and scoped to that one
// attendee. There is no way to read or touch anybody else's bookings, which is
// what keeps a stolen token a nuisance rather than a breach.
//
// Capacity is not enforced here. It is enforced by `sign_up_for_session`, which
// locks the schedule row and counts inside the transaction — doing it in the
// Worker would race the moment two people tap the last seat together.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { getCurrentEdition } from './editions';
import { authenticateDevice, type DeviceIdentity } from './attendee-auth';
import { pairingGateDay } from './event-day';
import { notifyInBackground } from './push-send';
import type { CheckInEvent, EventDay } from './admin/check-in-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maps a database exception onto something the app can act on. */
const SIGNUP_ERRORS: Record<string, { error: string; status: number }> = {
  session_not_found: { error: 'session_not_found', status: 404 },
  session_not_bookable: { error: 'session_not_bookable', status: 409 },
  session_not_published: { error: 'session_not_bookable', status: 409 },
  attendee_not_found: { error: 'attendee_not_found', status: 404 },
  wrong_edition: { error: 'wrong_edition', status: 409 },
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
 * Whether this attendee may book right now.
 *
 * During the event: they must have arrived today, so a booked seat means someone
 * in the building. Outside it: any day their ticket covers, which lets the whole
 * flow be rehearsed rather than first run at the door. Same rule as issuing a
 * pairing code, from the same function, so the two cannot disagree.
 */
async function canBook(
  sb: SupabaseClient,
  attendeeId: string,
  edition: { start_date: string; end_date: string },
): Promise<boolean> {
  const [attendee, events] = await Promise.all([
    sb.from('attendees').select('registration_id').eq('id', attendeeId).maybeSingle(),
    sb.from('check_in_events').select('id, day, kind, voids_event_id, occurred_at').eq('attendee_id', attendeeId),
  ]);
  if (attendee.error || events.error || !attendee.data) return false;

  const reg = await sb
    .from('registrations')
    .select('days')
    .eq('id', (attendee.data as { registration_id: string }).registration_id)
    .maybeSingle();
  if (reg.error) return false;

  const ticketDays = (reg.data as { days: EventDay[] } | null)?.days ?? [];
  return pairingGateDay(edition, ticketDays, (events.data ?? []) as CheckInEvent[]) !== null;
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

  return jsonResponse({ signups: data ?? [] });
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
  if (!(await canBook(sb, identity.attendee_id, edition))) {
    return jsonResponse({ error: 'not_checked_in' }, 409);
  }

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
