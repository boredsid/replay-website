// Exchanging a kiosk pairing code for a device token.
//
// The only genuinely new public endpoint in this roadmap. Everything protecting
// it is here: the code is the whole credential, so it is ~40 bits rather than six
// digits, single-use, three-minute TTL, and rate limited twice.
//
// There is deliberately no phone field. A guest seat has no number on record
// until the desk captures one, so binding the exchange to a phone would lock out
// exactly the people this flow exists for — and would gain nothing a longer code
// does not already provide.
import type { Env } from './index';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { getCurrentEdition } from './editions';
import {
  generateDeviceToken,
  generateQrToken,
  hashToken,
  isWellFormedPairingCode,
  normalizePairingCode,
} from './attendee-tokens';
import { seatLabel } from './admin/check-in';
import { publicRequestAllowed } from './rate-limit';

// There is no failed-attempt counter here, and `pairing_codes.attempts` has no
// writer. It is a leftover from the phone-plus-code design, where a lookup by
// phone let you count wrong guesses against one attendee. With the code as the
// sole credential the lookup is by hash, so a wrong guess matches no row and
// there is nothing to count against. The defence is the code's ~40 bits plus the
// two rate limiters below. The column is left in place rather than migrated away
// for a future per-attendee retry flow.

/** The token outlives the event by a day so nothing expires mid-pack-down. */
const DEVICE_TTL_DAYS = 1;

/**
 * One response for every failure.
 *
 * Distinguishing "no such code" from "expired" from "already used" would tell
 * someone probing the endpoint which guesses were close. The app can still be
 * specific about the things it knows locally, like a code of the wrong length.
 */
function refuse(): Response {
  return jsonResponse({ error: 'pairing_failed' }, 400);
}

export async function handleAppPair(req: Request, env: Env): Promise<Response> {
  let code: string;
  try {
    const body = await req.json<{ code?: string }>();
    code = normalizePairingCode(body?.code);
  } catch {
    return refuse();
  }
  if (!isWellFormedPairingCode(code)) return refuse();

  // Throttled per client network, and again on the code itself, so neither a
  // single machine nor a spread of them can grind through the space.
  if (!(await publicRequestAllowed(env, req, 'app-pair', code))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const sb = serviceClient(env);
  const edition = await getCurrentEdition(env);
  if (!edition) return jsonResponse({ error: 'event_unavailable' }, 503);

  const lookup = await sb
    .from('pairing_codes')
    .select('id, attendee_id, edition_id, expires_at, consumed_at')
    .eq('code_hash', await hashToken(code))
    .is('consumed_at', null)
    .maybeSingle();
  if (lookup.error) return jsonResponse({ error: 'pairing_unavailable' }, 500);
  if (!lookup.data) return refuse();

  const row = lookup.data as {
    id: string; attendee_id: string; edition_id: string;
    expires_at: string; consumed_at: string | null;
  };

  if (row.edition_id !== edition.id) return refuse();

  if (Date.parse(row.expires_at) <= Date.now()) {
    // Retire it rather than leaving a dead row occupying the attendee's single
    // outstanding-code slot.
    await sb.from('pairing_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
    return refuse();
  }

  const attendee = await sb
    .from('attendees')
    .select('id, seat_index, display_name')
    .eq('id', row.attendee_id)
    .maybeSingle();
  if (attendee.error || !attendee.data) return refuse();
  const person = attendee.data as { id: string; seat_index: number; display_name: string | null };

  const now = new Date();
  const consumed = await sb
    .from('pairing_codes')
    .update({ consumed_at: now.toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();
  // Losing this race means another device redeemed the same code first. Single
  // use has to mean single use, so the loser gets nothing.
  if (consumed.error || !consumed.data) return refuse();

  // Re-pairing replaces: a lost phone stops working the moment its owner pairs a
  // new one, without anybody having to remember to revoke it.
  await sb
    .from('attendee_devices')
    .update({ revoked_at: now.toISOString(), revoked_by: 'repair' })
    .eq('attendee_id', person.id)
    .is('revoked_at', null);
  await sb
    .from('attendee_credentials')
    .update({ revoked_at: now.toISOString(), revoked_by: 'repair' })
    .eq('attendee_id', person.id)
    .is('revoked_at', null);

  const token = generateDeviceToken();
  const qrToken = generateQrToken();
  const expiresAt = new Date(
    Date.parse(`${edition.end_date}T23:59:59+05:30`) + DEVICE_TTL_DAYS * 86_400_000,
  ).toISOString();

  const device = await sb.from('attendee_devices').insert({
    attendee_id: person.id,
    edition_id: edition.id,
    token_hash: await hashToken(token),
    expires_at: expiresAt,
  });
  if (device.error) return jsonResponse({ error: 'pairing_unavailable' }, 500);

  const credential = await sb.from('attendee_credentials').insert({
    attendee_id: person.id,
    edition_id: edition.id,
    qr_token_hash: await hashToken(qrToken),
  });
  if (credential.error) return jsonResponse({ error: 'pairing_unavailable' }, 500);

  // Both plaintexts exist only here. The app names the attendee back to them
  // immediately, so someone who typed a neighbour's code sees it while both are
  // still standing in front of staff.
  return jsonResponse({
    token,
    expires_at: expiresAt,
    qr_token: qrToken,
    display_name: seatLabel(person.display_name, person.seat_index),
  });
}

