// Handing an attendee their app code, and resolving a scanned QR.
//
// Both are staff actions behind Cloudflare Access. Issuing a code is deliberately
// separate from checking someone in: the desk is busy on arrival and most people
// just want to get inside, so this is a button staff press when someone asks —
// including hours later, as often as they like.
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';
import { getCurrentEdition } from '../editions';
import { generatePairingCode, hashToken, normalizePairingCode } from '../attendee-tokens';
import { editionDayForToday, pairingGateDay } from '../event-day';
import { hasArrivedOn, seatLabel } from './check-in';

// Re-exported so existing callers and tests keep one import site.
export { editionDayForToday, pairingGateDay };
import type { CheckInEvent, EventDay } from './check-in-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Short enough that a code read out across a desk is not still live later. */
const CODE_TTL_MS = 3 * 60 * 1000;

/**
 * Issues a fresh pairing code for one attendee.
 *
 * A code is per person, never per registration: two people from one purchase get
 * a code each, so they pair their own phones and book their own sessions. The
 * response carries the attendee's name so the kiosk can label it — two unlabelled
 * codes on one screen is how somebody types the wrong one and pairs into
 * another person's identity.
 */
export async function handlePairingCodeIssue(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let attendeeId: string;
  try {
    const body = await req.json<{ attendee_id?: string }>();
    if (!UUID.test(String(body?.attendee_id ?? ''))) throw new Error('invalid_attendee_id');
    attendeeId = body.attendee_id!;
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const edition = await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_current_edition' }, 503, origin);

  const attendee = await sb
    .from('attendees')
    .select('id, edition_id, seat_index, display_name, registration_id')
    .eq('id', attendeeId)
    .maybeSingle();
  if (attendee.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!attendee.data) return adminJson({ error: 'attendee_not_found' }, 404, origin);
  const row = attendee.data as {
    id: string; edition_id: string; seat_index: number;
    display_name: string | null; registration_id: string;
  };

  const [reg, events] = await Promise.all([
    sb.from('registrations').select('days').eq('id', row.registration_id).maybeSingle(),
    sb.from('check_in_events').select('id, day, kind, voids_event_id, occurred_at').eq('attendee_id', row.id),
  ]);
  if (reg.error || events.error) return adminJson({ error: 'query_failed' }, 500, origin);
  const ticketDays = ((reg.data as { days: EventDay[] } | null)?.days ?? []);

  // Arrived, not "currently inside" — someone who stepped out for lunch has not
  // stopped being here.
  const gateDay = pairingGateDay(
    edition as unknown as { start_date: string; end_date: string },
    ticketDays,
    (events.data ?? []) as CheckInEvent[],
  );
  if (!gateDay) return adminJson({ error: 'not_checked_in' }, 409, origin);

  // At most one outstanding code per attendee, enforced by a partial unique
  // index, so the previous one has to be retired before a new one is minted.
  const consumed = await sb
    .from('pairing_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('attendee_id', row.id)
    .is('consumed_at', null);
  if (consumed.error) return adminJson({ error: 'code_reset_failed' }, 500, origin);

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const insert = await sb.from('pairing_codes').insert({
    attendee_id: row.id,
    edition_id: row.edition_id,
    code_hash: await hashToken(code),
    expires_at: expiresAt,
    issued_by: actorEmail,
  });
  if (insert.error) return adminJson({ error: 'code_issue_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'pairing_code.issue',
    target_table: 'pairing_codes',
    target_id: row.id,
    // Never the code itself: the audit log is not a place to leak a live credential.
    diff: { attendee_id: row.id, expires_at: expiresAt },
  });

  return adminJson(
    {
      code,
      expires_at: expiresAt,
      attendee_name: seatLabel(row.display_name, row.seat_index),
    },
    200,
    origin,
  );
}

/**
 * Resolves a scanned QR to the person holding it.
 *
 * This endpoint is the reason the QR is safe to photograph: possessing the token
 * does nothing without an authenticated staff session, so the privilege lives in
 * the scanner, not the badge. The response is a summary for the person doing the
 * scanning — never contact details.
 */
export async function handleScan(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  let token: string;
  try {
    const body = await req.json<{ qr_token?: string }>();
    token = normalizePairingCode(body?.qr_token);
    if (!token) throw new Error('invalid_qr_token');
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const edition = await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_current_edition' }, 503, origin);

  const credential = await sb
    .from('attendee_credentials')
    .select('attendee_id, edition_id')
    .eq('qr_token_hash', await hashToken(token))
    .is('revoked_at', null)
    .maybeSingle();
  if (credential.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!credential.data) return adminJson({ error: 'unknown_pass' }, 404, origin);
  const cred = credential.data as { attendee_id: string; edition_id: string };

  if (cred.edition_id !== edition.id) return adminJson({ error: 'wrong_edition' }, 409, origin);

  const attendee = await sb
    .from('attendees')
    .select('id, seat_index, display_name, registration_id')
    .eq('id', cred.attendee_id)
    .maybeSingle();
  if (attendee.error || !attendee.data) return adminJson({ error: 'attendee_not_found' }, 404, origin);
  const row = attendee.data as { id: string; seat_index: number; display_name: string | null; registration_id: string };

  const [reg, events] = await Promise.all([
    sb.from('registrations').select('pass_type, days, payment_status').eq('id', row.registration_id).maybeSingle(),
    sb.from('check_in_events').select('id, day, kind, voids_event_id, occurred_at').eq('attendee_id', row.id),
  ]);
  if (reg.error || events.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const registration = reg.data as { pass_type: string; days: EventDay[]; payment_status: string } | null;
  if (!registration || registration.payment_status !== 'confirmed') {
    return adminJson({ error: 'not_confirmed' }, 409, origin);
  }

  const eventRows = (events.data ?? []) as CheckInEvent[];
  return adminJson(
    {
      attendee_id: row.id,
      // The name is the point: staff eyeball it against the person in front of
      // them, which is what makes a screenshotted QR a poor way to impersonate.
      name: seatLabel(row.display_name, row.seat_index),
      pass_type: registration.pass_type,
      days: registration.days,
      arrived_today: registration.days.some((day) => hasArrivedOn(eventRows, day)),
      // Populated once the library ships; present now so the scan surface does
      // not change shape later.
      active_loans: [],
    },
    200,
    origin,
  );
}
