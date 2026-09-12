// The attendee's own bookings.
//
// Everything here needs a device token, so none of it works — or is offered —
// until someone has paired at the desk. The public half of the app carries on
// regardless, which is the whole arrangement.

import { API_BASE } from './api';
import { formatDate } from './event-time';
import type { Device } from './device';
import type { ScheduleItem } from '../types';

export type SignupStatus = 'confirmed' | 'waitlisted';

export interface Signup {
  schedule_item_id: string;
  status: SignupStatus;
  signed_up_at: string;
  promoted_at: string | null;
  /** Place in the queue when waitlisted, so the card can say it in place. */
  queue_position: number;
}

export type SignupError =
  /** The token is gone or dead; the app should send them back through setup. */
  | 'unauthorised'
  /** They have not checked in today, so booking is not open to them yet. */
  | 'not_checked_in'
  /** Checked in, but not for the day this session runs on. */
  | 'wrong_day'
  /** They already hold something that overlaps this session. */
  | 'session_clash'
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
  if (body.error === 'wrong_day') return 'wrong_day';
  if (body.error === 'session_clash') return 'session_clash';
  if (body.error === 'session_not_bookable') return 'session_not_bookable';
  return 'failed';
}

export interface MySignups {
  signups: Signup[];
  /**
   * The dates the desk has let this person into, so the schedule can grey out a
   * day rather than offer a button the server will refuse.
   *
   * Null means the server could not say. The app then offers everything and
   * lets the refusal explain itself — inventing a restriction from a failed
   * lookup would lock somebody out of a day they are standing in.
   */
  bookableDates: string[] | null;
}

export async function fetchSignups(device: Device): Promise<MySignups | null> {
  try {
    const response = await fetch(`${API_BASE}/api/app/me/signups`, {
      headers: authHeaders(device),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json() as { signups?: Signup[]; bookable_dates?: string[] | null };
    return {
      signups: Array.isArray(body.signups) ? body.signups : [],
      bookableDates: Array.isArray(body.bookable_dates) ? body.bookable_dates : null,
    };
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

/**
 * Whether two sessions cannot both be attended.
 *
 * Must agree with the guard in `sign_up_for_session`, which is the one that
 * actually decides — this copy exists so the app can grey a button out rather
 * than let someone tap it and be told no. Three rules, all matching the SQL:
 * a different day never clashes, an all-day item clashes with nothing (one
 * open-play sign-up must not swallow the whole programme), and touching ends
 * are back to back rather than overlapping.
 */
export function overlaps(a: ScheduleItem, b: ScheduleItem): boolean {
  if (a.day !== b.day) return false;
  if (a.is_all_day || b.is_all_day) return false;
  if (!a.start_time || !a.end_time || !b.start_time || !b.end_time) return false;
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

export interface BookingBlock {
  reason: 'wrong-day' | 'clash';
  /** What the button says in place of "Book". */
  label: string;
  /** The line under the card that explains it. */
  detail: string;
}

/**
 * Why this session cannot be booked right now, or null when it can be.
 *
 * Only ever a reason to disable a button. The server refuses independently, so
 * a wrong answer here costs an explanation, never a rule.
 */
export function bookingBlock(
  item: ScheduleItem,
  signups: Map<string, Signup>,
  schedule: readonly ScheduleItem[],
  bookableDates: readonly string[] | null,
): BookingBlock | null {
  // Already holding it: the card offers to give it up, and nothing blocks that.
  if (signups.has(item.id)) return null;

  if (bookableDates && !bookableDates.includes(item.day)) {
    return {
      reason: 'wrong-day',
      label: 'Not today',
      detail: `Check in on ${formatDate(item.day)} and this opens up.`,
    };
  }

  // A queued place counts as held: promotion is immediate, so a waitlist can
  // become a seat while somebody is sitting in the session it overlaps.
  const held = schedule.find((other) => signups.has(other.id) && overlaps(other, item));
  if (held) {
    return {
      reason: 'clash',
      label: 'Clashes',
      detail: `Overlaps ${held.title}. Give that up first if you would rather do this.`,
    };
  }

  return null;
}
