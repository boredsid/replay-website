// Device-token auth for the attendee app.
//
// A device token authorises one attendee's own records and nothing else. The
// worst case for a stolen one is interference with a single person's session
// bookings — it reaches no contact details, no payment state, and nobody else's
// data. That narrowness is the whole security argument for handing tokens out at
// a desk rather than building an account system.
import type { SupabaseClient } from '@supabase/supabase-js';
import { bearerToken, hashToken } from './attendee-tokens';
import { hasArrivedOn, type CheckInEvent, type EventDay } from './admin/check-in-state';

export interface DeviceIdentity {
  attendee_id: string;
  edition_id: string;
  device_id: string;
}

export type DeviceAuthResult =
  | { ok: true; identity: DeviceIdentity }
  | { ok: false; error: 'missing_token' | 'invalid_token' | 'expired_token' | 'revoked_token' | 'query_failed' };

/**
 * Resolves the bearer token to an attendee.
 *
 * Revocation and expiry are checked here rather than left to a `where` clause so
 * the caller can tell an expired token from a bogus one — the app clears storage
 * and restarts the wizard for the first, and should not for the second.
 */
export async function authenticateDevice(
  req: Request,
  sb: SupabaseClient,
): Promise<DeviceAuthResult> {
  const raw = bearerToken(req);
  if (!raw) return { ok: false, error: 'missing_token' };

  const { data, error } = await sb
    .from('attendee_devices')
    .select('id, attendee_id, edition_id, expires_at, revoked_at')
    .eq('token_hash', await hashToken(raw))
    .maybeSingle();
  if (error) return { ok: false, error: 'query_failed' };
  if (!data) return { ok: false, error: 'invalid_token' };

  const device = data as {
    id: string; attendee_id: string; edition_id: string;
    expires_at: string; revoked_at: string | null;
  };

  if (device.revoked_at) return { ok: false, error: 'revoked_token' };
  if (Date.parse(device.expires_at) <= Date.now()) return { ok: false, error: 'expired_token' };

  // Best-effort liveness for the desk; never worth failing a request over.
  void sb.from('attendee_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id);

  return {
    ok: true,
    identity: { attendee_id: device.attendee_id, edition_id: device.edition_id, device_id: device.id },
  };
}

/**
 * Whether this attendee arrived on the given day.
 *
 * Gates sign-ups, and is evaluated at the moment of the action rather than at
 * pairing time: a device paired on day 1 must not book day 2 sessions until that
 * person actually turns up on day 2. It asks whether they arrived, not whether
 * they are inside right now, so stepping out for lunch does not revoke anything.
 */
export async function hasArrivedToday(
  sb: SupabaseClient,
  attendeeId: string,
  day: EventDay,
): Promise<boolean> {
  const { data, error } = await sb
    .from('check_in_events')
    .select('id, day, kind, voids_event_id, occurred_at')
    .eq('attendee_id', attendeeId);
  if (error) return false;
  return hasArrivedOn((data ?? []) as CheckInEvent[], day);
}
