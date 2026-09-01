// Subscribing a browser to notifications, and changing one's mind afterwards.
//
// Every route needs a device token, so notifications are only ever offered to
// someone who has paired at the desk. Turning them off has to be as easy as
// turning them on, which is why unsubscribing needs no confirmation and no
// explanation.
import type { Env } from './index';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { getCurrentEdition } from './editions';
import { authenticateDevice } from './attendee-auth';

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    // Only https: a push endpoint is a URL we will POST to, so anything else is
    // either a mistake or an attempt to make the Worker fetch something odd.
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function handlePushSubscribe(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const auth = await authenticateDevice(req, sb);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.error === 'query_failed' ? 503 : 401);
  }

  let body: SubscribeBody;
  try {
    body = await req.json<SubscribeBody>();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  if (!validEndpoint(body.endpoint)) return jsonResponse({ error: 'invalid_endpoint' }, 400);
  const p256dh = body.keys?.p256dh;
  const authKey = body.keys?.auth;
  if (typeof p256dh !== 'string' || typeof authKey !== 'string' || !p256dh || !authKey) {
    return jsonResponse({ error: 'invalid_keys' }, 400);
  }

  const edition = await getCurrentEdition(env);
  if (!edition) return jsonResponse({ error: 'event_unavailable' }, 503);

  // Upsert on the endpoint: a browser that re-subscribes must update its row,
  // not add a second one that would deliver everything twice. Re-subscribing
  // also clears a previous revocation, which is how someone turns push back on.
  const { error } = await sb
    .from('push_subscriptions')
    .upsert({
      attendee_id: auth.identity.attendee_id,
      edition_id: edition.id,
      endpoint: body.endpoint,
      p256dh,
      auth: authKey,
      revoked_at: null,
      failure_count: 0,
    }, { onConflict: 'endpoint' });
  if (error) return jsonResponse({ error: 'subscribe_failed' }, 500);

  return jsonResponse({ subscribed: true });
}

export async function handlePushUnsubscribe(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const auth = await authenticateDevice(req, sb);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.error === 'query_failed' ? 503 : 401);
  }

  // Scoped to this attendee, so a token can only ever silence its own devices.
  const { error } = await sb
    .from('push_subscriptions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('attendee_id', auth.identity.attendee_id)
    .is('revoked_at', null);
  if (error) return jsonResponse({ error: 'unsubscribe_failed' }, 500);

  return jsonResponse({ subscribed: false });
}

const CATEGORIES = ['wants_waitlist', 'wants_announcements', 'wants_reminders'] as const;

/**
 * Turning individual categories on and off.
 *
 * Someone who wants to know a seat opened may well not want every announcement,
 * and forcing that into one switch would cost us the subscription entirely.
 */
export async function handlePushPreferences(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const auth = await authenticateDevice(req, sb);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.error === 'query_failed' ? 503 : 401);
  }

  let patch: Record<string, boolean>;
  try {
    const body = await req.json<Record<string, unknown>>();
    patch = {};
    for (const key of CATEGORIES) {
      if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean;
    }
    if (Object.keys(patch).length === 0) throw new Error('nothing_to_update');
  } catch (error) {
    return jsonResponse({ error: (error as Error).message || 'invalid_body' }, 400);
  }

  const { error } = await sb
    .from('push_subscriptions')
    .update(patch)
    .eq('attendee_id', auth.identity.attendee_id)
    .is('revoked_at', null);
  if (error) return jsonResponse({ error: 'preferences_failed' }, 500);

  return jsonResponse({ ok: true, ...patch });
}

/** What the app needs to subscribe: the public key, and whether push is on. */
export async function handlePushConfig(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const auth = await authenticateDevice(req, sb);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.error === 'query_failed' ? 503 : 401);
  }

  const { data, error } = await sb
    .from('push_subscriptions')
    .select('wants_waitlist, wants_announcements, wants_reminders')
    .eq('attendee_id', auth.identity.attendee_id)
    .is('revoked_at', null)
    .limit(1);
  if (error) return jsonResponse({ error: 'query_failed' }, 500);

  const existing = (data ?? [])[0] as Record<string, boolean> | undefined;
  return jsonResponse({
    // Empty when the secret is unset, which the app reads as "push unavailable"
    // rather than showing a control that cannot work.
    vapid_public_key: env.VAPID_PRIVATE_KEY ? env.VAPID_PUBLIC_KEY : null,
    subscribed: Boolean(existing),
    preferences: existing ?? { wants_waitlist: true, wants_announcements: true, wants_reminders: true },
  });
}
