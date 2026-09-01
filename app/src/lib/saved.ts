// Mirroring My Day to the server, for the reminder.
//
// The local set stays authoritative for what the screen shows: it is instant,
// it survives a dead network, and it works for someone who never pairs. The
// server copy exists for one reason — a cron cannot read a phone, so a star
// that only lives here can never turn into a notification.
//
// Every call is therefore best-effort. A failed sync costs a reminder, never a
// star: the tap has already been recorded locally by the time any of this runs.

import { API_BASE } from './api';
import type { Device } from './device';

function authHeaders(device: Device): HeadersInit {
  return { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' };
}

/** Stars this session server-side. Resolves false if it did not land. */
export async function pushSaved(device: Device, scheduleItemId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/app/saved/${scheduleItemId}`, {
      method: 'PUT',
      headers: authHeaders(device),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function pushUnsaved(device: Device, scheduleItemId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/app/saved/${scheduleItemId}`, {
      method: 'DELETE',
      headers: authHeaders(device),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Folds this phone's stars into the server's and returns the union.
 *
 * Run on every start with a paired device, not only at the moment of pairing.
 * Most people star their weekend days before they arrive and pair at the desk,
 * so the interesting list is always the one that predates the pairing; and a
 * sync that failed on a bad connection has to get another chance at some point.
 *
 * Returns null when the merge did not happen, which the caller treats as "keep
 * what you had" rather than "you have nothing saved".
 */
export async function mergeSaved(
  device: Device,
  local: ReadonlySet<string>,
): Promise<Set<string> | null> {
  try {
    const response = await fetch(`${API_BASE}/api/app/saved/merge`, {
      method: 'POST',
      headers: authHeaders(device),
      body: JSON.stringify({ schedule_item_ids: [...local] }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { saved?: string[] };
    return Array.isArray(body.saved) ? new Set(body.saved) : null;
  } catch {
    return null;
  }
}
