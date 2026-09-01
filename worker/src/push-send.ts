// Fanning a notification out to an attendee's browsers, and keeping the
// subscription table honest afterwards.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPush, type PushConfig } from './web-push';

export type PushCategory = 'waitlist' | 'announcements' | 'reminders';

const CATEGORY_COLUMN: Record<PushCategory, string> = {
  waitlist: 'wants_waitlist',
  announcements: 'wants_announcements',
  reminders: 'wants_reminders',
};

export interface Notification {
  title: string;
  body: string;
  /** Where tapping it should land, as an in-app hash route. */
  url?: string;
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

/**
 * Reads the VAPID configuration, or nothing.
 *
 * The private key is a Worker secret and is absent locally and in tests, which
 * must disable sending rather than crash a request that happens to touch it.
 */
export function pushConfig(env: Env): PushConfig | null {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

export interface FanOutResult {
  sent: number;
  pruned: number;
  failed: number;
}

/**
 * Sends one notification to every live subscription for these attendees that
 * has opted into this category.
 *
 * Nothing here is allowed to throw: every caller is doing something more
 * important than notifying — promoting someone off a waitlist, publishing an
 * incident notice — and a push failure must not undo that.
 */
export async function notifyAttendees(
  env: Env,
  sb: SupabaseClient,
  attendeeIds: readonly string[],
  category: PushCategory,
  notification: Notification,
): Promise<FanOutResult> {
  const empty: FanOutResult = { sent: 0, pruned: 0, failed: 0 };
  const config = pushConfig(env);
  if (!config || attendeeIds.length === 0) return empty;

  const { data, error } = await sb
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .in('attendee_id', attendeeIds)
    .is('revoked_at', null)
    .eq(CATEGORY_COLUMN[category], true);
  if (error) return empty;

  const rows = (data ?? []) as SubscriptionRow[];
  const payload = JSON.stringify(notification);
  const result: FanOutResult = { sent: 0, pruned: 0, failed: 0 };
  const now = new Date().toISOString();

  for (const row of rows) {
    const outcome = await sendPush(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      payload,
      config,
    );

    if (outcome.ok) {
      result.sent += 1;
      await sb.from('push_subscriptions')
        .update({ last_success_at: now, failure_count: 0 })
        .eq('id', row.id);
      continue;
    }

    if (outcome.gone) {
      // The browser is gone, the user cleared site data, or the endpoint
      // rotated. Retrying forever is how a send loop becomes all dead endpoints.
      result.pruned += 1;
      await sb.from('push_subscriptions')
        .update({ revoked_at: now })
        .eq('id', row.id);
      continue;
    }

    result.failed += 1;
    await sb.from('push_subscriptions')
      .update({ failure_count: row.failure_count + 1 })
      .eq('id', row.id);
  }

  return result;
}

/**
 * Fire-and-forget wrapper for callers whose real work must not wait on push.
 *
 * A waitlist promotion has already happened by the time we try to tell anyone;
 * failing to notify is a worse outcome only for the notification.
 */
export function notifyInBackground(
  env: Env,
  sb: SupabaseClient,
  attendeeIds: readonly string[],
  category: PushCategory,
  notification: Notification,
): void {
  void notifyAttendees(env, sb, attendeeIds, category, notification)
    .catch((error) => console.error('push_fan_out_failed', error));
}
