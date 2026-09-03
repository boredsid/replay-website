// Turning notifications on, and off again.
//
// Permission is asked at the moment of value — joining a waitlist — and never on
// first load. A prompt someone does not understand yet gets denied, and a denied
// permission cannot be asked for a second time: the browser remembers it, and
// the only way back is through site settings most people will never find.

import { API_BASE } from './api';
import type { Device } from './device';

export interface PushPreferences {
  wants_waitlist: boolean;
  wants_announcements: boolean;
  wants_reminders: boolean;
}

export interface PushState {
  /** Null when the server has no VAPID key, meaning push is unavailable. */
  vapidPublicKey: string | null;
  subscribed: boolean;
  preferences: PushPreferences;
}

export type PushSetupResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'failed' };

function authHeaders(device: Device): HeadersInit {
  return { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' };
}

/** Whether this browser can do push at all. iOS only can once installed. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/**
 * Whether asking is still possible.
 *
 * A denied permission is permanent from the page's point of view, so the UI must
 * stop offering rather than presenting a button that silently does nothing.
 */
export function permissionState(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function fetchPushState(device: Device): Promise<PushState | null> {
  try {
    const response = await fetch(`${API_BASE}/api/app/push`, {
      headers: authHeaders(device),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json() as {
      vapid_public_key: string | null;
      subscribed: boolean;
      preferences: PushPreferences;
    };
    return {
      vapidPublicKey: body.vapid_public_key,
      subscribed: body.subscribed,
      preferences: body.preferences,
    };
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Hands one browser's subscription to the server. Upserts on the endpoint. */
async function registerSubscription(device: Device, subscription: PushSubscription): Promise<boolean> {
  const raw = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    const response = await fetch(`${API_BASE}/api/app/push/subscribe`, {
      method: 'POST',
      headers: authHeaders(device),
      body: JSON.stringify({ endpoint: raw.endpoint, keys: raw.keys }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Corrects the server's idea of "subscribed" with what this browser actually holds.
 *
 * The server answers per attendee, not per browser: any live row makes it say
 * yes. So a phone that has lost its subscription -- the app removed from the
 * home screen and added again, site data cleared, the endpoint rotated -- is
 * told it is already subscribed, offers nobody the switch, and never registers
 * again. Every notification then goes to the old endpoint, which Apple and
 * Google keep accepting for a while after the install behind it is gone: sends
 * report success and no phone ever buzzes.
 *
 * Asking the browser is the only reliable answer. Re-subscribing needs no prompt
 * when permission is already granted, so this is silent, and re-registering an
 * unchanged endpoint is an upsert -- which also repairs a row left pointing at
 * the wrong attendee after re-pairing.
 */
export async function reconcilePush(device: Device, state: PushState): Promise<PushState> {
  if (!state.vapidPublicKey || !pushSupported()) return { ...state, subscribed: false };
  // Without permission there is nothing to reconcile, and the UI should be free
  // to offer the switch again rather than believing a row from a dead install.
  if (Notification.permission !== 'granted') return { ...state, subscribed: false };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey).slice().buffer as ArrayBuffer,
      });
    return { ...state, subscribed: await registerSubscription(device, subscription) };
  } catch {
    return { ...state, subscribed: false };
  }
}

/**
 * Asks permission, subscribes with the push service, and registers the result.
 *
 * The subscription belongs to the service worker, so this only works once one is
 * registered — which it is in production, and is not in a dev tab. That is why a
 * failure here is reported rather than thrown.
 */
export async function enablePush(device: Device, vapidPublicKey: string): Promise<PushSetupResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      // Required by every browser: a push without a payload the user can see is
      // not allowed, which suits us since every notification here has content.
      userVisibleOnly: true,
      // Copied into a plain ArrayBuffer: the DOM types reject the possibly-shared
      // buffer a Uint8Array carries.
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).slice().buffer as ArrayBuffer,
    });

    if (!await registerSubscription(device, subscription)) return { ok: false, reason: 'failed' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Turns notifications off.
 *
 * Unsubscribes locally as well as on the server: leaving the browser subscribed
 * would keep the endpoint alive and deliver anything sent before the server row
 * was revoked.
 */
export async function disablePush(device: Device): Promise<boolean> {
  try {
    if (pushSupported()) {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
    }
    const response = await fetch(`${API_BASE}/api/app/push/subscribe`, {
      method: 'DELETE',
      headers: authHeaders(device),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function updatePushPreferences(
  device: Device,
  patch: Partial<PushPreferences>,
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/app/push/preferences`, {
      method: 'PATCH',
      headers: authHeaders(device),
      body: JSON.stringify(patch),
    });
    return response.ok;
  } catch {
    return false;
  }
}
