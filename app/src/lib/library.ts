// Borrowing a game, from the phone.
//
// The catalogue is not fetched. All 586 titles ship with the app as a static
// snapshot loaded on demand, and the server is asked only which of them have
// nothing free — a list proportional to how many boxes are out, not to how big
// the shelf is. Everything unlisted is available.

import { API_BASE } from './api';
import type { Device } from './device';

export interface LibraryHold {
  loan_id: string;
  title_key: string | null;
  title: string | null;
  copy_number: number | null;
  expires_at: string;
}

export interface LibraryLoan {
  loan_id: string;
  title_key: string | null;
  title: string | null;
  copy_number: number | null;
  due_at: string | null;
  overdue: boolean;
}

export interface LibraryState {
  can_borrow: boolean;
  /** Title keys with no free copy. Everything else on the shelf is free. */
  unavailable: string[];
  hold: LibraryHold | null;
  loan: LibraryLoan | null;
}

export type LibraryError =
  | 'unauthorised'
  | 'not_checked_in'
  | 'no_copy_available'
  /** They already have a game, or a hold on one. */
  | 'already_holding'
  | 'library_last_call'
  | 'offline'
  | 'failed';

function authHeaders(device: Device): HeadersInit {
  return { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' };
}

async function classify(response: Response): Promise<LibraryError> {
  if (response.status === 401) return 'unauthorised';
  let body: { error?: string } = {};
  try { body = await response.json(); } catch { /* non-JSON error body */ }
  const known: LibraryError[] = ['not_checked_in', 'no_copy_available', 'already_holding', 'library_last_call'];
  return known.find((error) => error === body.error) ?? 'failed';
}

/** Null means it could not be read; the caller keeps what it had. */
export async function fetchLibrary(device: Device): Promise<LibraryState | null> {
  try {
    const response = await fetch(`${API_BASE}/api/app/library`, {
      headers: authHeaders(device),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json() as LibraryState;
    return Array.isArray(body.unavailable) ? body : null;
  } catch {
    return null;
  }
}

export type RequestResult =
  | { ok: true; expires_at: string; copy_number: number }
  | { ok: false; error: LibraryError };

export async function requestGame(device: Device, titleKey: string): Promise<RequestResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/app/library/request`, {
      method: 'POST',
      headers: authHeaders(device),
      body: JSON.stringify({ title_key: titleKey }),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (!response.ok) return { ok: false, error: await classify(response) };
  const body = await response.json() as { expires_at: string; copy_number: number };
  return { ok: true, expires_at: body.expires_at, copy_number: body.copy_number };
}

export async function cancelRequest(device: Device): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/app/library/request`, {
      method: 'DELETE',
      headers: authHeaders(device),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Whole minutes left, floored at zero so a lapsed hold never reads negative. */
export function minutesLeft(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
}

/** "1h 20m left", or "Due now" once the clock has run out. */
export function dueLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
}

/** What to say when a request is refused, in the attendee's own terms. */
export function requestErrorMessage(error: LibraryError): string {
  switch (error) {
    case 'not_checked_in':
      return 'Check in at the desk first, then you can borrow.';
    case 'no_copy_available':
      return 'Someone got the last copy. Try another game.';
    case 'already_holding':
      return 'You already have a game. Bring it back to borrow another.';
    case 'library_last_call':
      return 'The library has stopped lending for today.';
    case 'offline':
      return 'No connection. Try again in a moment.';
    case 'unauthorised':
      return 'Your setup expired. Ask the desk for a new code.';
    default:
      return 'That did not work. Try again.';
  }
}
