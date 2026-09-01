// The device's identity: one attendee, this browser.
//
// A device token reaches that attendee's own records and nothing else, so what
// is kept here is deliberately small — the token, the QR the desk minted with
// it, and the name to show back. No phone, no email, no registration id.

const STORAGE_KEY = 'replay.device';

export interface Device {
  token: string;
  qr_token: string;
  display_name: string;
  expires_at: string;
}

function isDevice(value: unknown): value is Device {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return typeof d.token === 'string'
    && typeof d.qr_token === 'string'
    && typeof d.display_name === 'string'
    && typeof d.expires_at === 'string';
}

/**
 * Reads the stored device, treating an expired or corrupt one as absent.
 *
 * Storage can throw outright in a private window or with site data blocked, so
 * every read is guarded — an attendee with cookies locked down should still get
 * the whole public app, just not the paired half.
 */
export function loadDevice(): Device | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDevice(parsed)) return null;
    if (Date.parse(parsed.expires_at) <= Date.now()) {
      clearDevice();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDevice(device: Device): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
  } catch {
    // Nothing to do: the pairing still worked for this session, and the app
    // stays usable. Losing it on reload beats refusing to pair at all.
  }
}

export function clearDevice(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignored for the same reason as above.
  }
}

export type PairOutcome =
  | { ok: true; device: Device }
  | { ok: false; reason: 'malformed' | 'rejected' | 'offline' | 'unavailable' };

/**
 * Crockford base32, folded the way the Worker folds it.
 *
 * Doing this on the device means the obvious misreads off a kiosk screen — O for
 * 0, I or L for 1 — never become a round trip, and the field can tell someone
 * their code is the wrong length before bothering the network.
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function isCompleteCode(code: string): boolean {
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(code);
}

export async function pairDevice(apiBase: string, rawCode: string): Promise<PairOutcome> {
  const code = normalizeCode(rawCode);
  // Checked here so an obviously incomplete code never leaves the device.
  if (!isCompleteCode(code)) return { ok: false, reason: 'malformed' };

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/app/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }

  if (response.status === 400) return { ok: false, reason: 'rejected' };
  if (!response.ok) return { ok: false, reason: 'unavailable' };

  const device = await response.json() as Device;
  if (!isDevice(device)) return { ok: false, reason: 'unavailable' };
  saveDevice(device);
  return { ok: true, device };
}
