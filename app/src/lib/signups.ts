// The attendee's own bookings.
//
// Everything here needs a device token, so none of it works — or is offered —
// until someone has paired at the desk. The public half of the app carries on
// regardless, which is the whole arrangement.

import { API_BASE } from './api';
import type { Device } from './device';

export type SignupStatus = 'confirmed' | 'waitlisted';

export interface Signup {
  schedule_item_id: string;
  status: SignupStatus;
  signed_up_at: string;
  promoted_at: string | null;
}

export type SignupError =
  /** The token is gone or dead; the app should send them back through setup. */
  | 'unauthorised'
  /** They have not checked in today, so booking is not open to them yet. */
  | 'not_checked_in'
  | 'session_not_bookable'
  | 'offline'
  | 'failed';

export type SignupResult =
  | { ok: true; status: SignupStatus; queue_position: number }
  | { ok: false; error: SignupError };

function authHeaders(device: Device): HeadersInit {
  return { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' };
}

/**
 * Maps a response onto something the caller can act on.
 *
 * 401 is the only status that should cost someone their pairing; a 503 means the
 * event service is unwell and their token is perfectly good.
 */
async function classify(response: Response): Promise<SignupError> {
  if (response.status === 401) return 'unauthorised';
  let body: { error?: string } = {};
  try { body = await response.json(); } catch { /* non-JSON error body */ }
  if (body.error === 'not_checked_in') return 'not_checked_in';
  if (body.error === 'session_not_bookable') return 'session_not_bookable';
  return 'failed';
}

export async function fetchSignups(device: Device): Promise<Signup[] | null> {
  try {
    const response = await fetch(`${API_BASE}/api/app/me/signups`, {
      headers: authHeaders(device),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json() as { signups?: Signup[] };
    return Array.isArray(body.signups) ? body.signups : [];
  } catch {
    // Offline. The caller keeps whatever it already had rather than blanking
    // the screen, since a stale booking list is far better than none.
    return null;
  }
}

export async function signUp(device: Device, scheduleItemId: string): Promise<SignupResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/app/signups`, {
      method: 'POST',
      headers: authHeaders(device),
      body: JSON.stringify({ schedule_item_id: scheduleItemId }),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (!response.ok) return { ok: false, error: await classify(response) };

  const body = await response.json() as { status: SignupStatus; queue_position: number };
  return { ok: true, status: body.status, queue_position: body.queue_position };
}

export async function cancelSignup(device: Device, scheduleItemId: string): Promise<{ ok: boolean; error?: SignupError }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/app/signups/${scheduleItemId}`, {
      method: 'DELETE',
      headers: authHeaders(device),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (!response.ok) return { ok: false, error: await classify(response) };
  return { ok: true };
}

/** Indexes bookings by session so a card can find its own in one lookup. */
export function bySession(signups: readonly Signup[]): Map<string, Signup> {
  return new Map(signups.map((s) => [s.schedule_item_id, s]));
}

/**
 * What the button should say.
 *
 * Seats remaining is only shown when a session is actually close to full —
 * "18 left" is noise, "2 left" is a reason to hurry.
 */
export function seatsLabel(seatsRemaining: number | null): string | null {
  if (seatsRemaining === null) return null;
  if (seatsRemaining === 0) return 'Full';
  if (seatsRemaining <= 5) return `${seatsRemaining} left`;
  return null;
}
