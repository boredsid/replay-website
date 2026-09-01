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
  /** Subscriptions skipped because one invocation cannot send to all of them. */
  skipped: number;
}

/**
 * How many push requests one invocation will make.
 *
 * Every send is a subrequest, and a Worker gets 50 of those per invocation on
 * the free plan and 1000 on paid. Exceeding it kills the whole invocation, so a
 * capped fan-out that logs what it skipped beats one that silently dies
 * partway.
 */
const MAX_SENDS_PER_INVOCATION = 400;

/** Sends in flight at once. Sequential sending is what makes a fan-out slow. */
const CONCURRENCY = 8;

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
  const empty: FanOutResult = { sent: 0, pruned: 0, failed: 0, skipped: 0 };
  const config = pushConfig(env);
  if (!config || attendeeIds.length === 0) return empty;

  const { data, error } = await sb
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .in('attendee_id', attendeeIds)
    .is('revoked_at', null)
    .eq(CATEGORY_COLUMN[category], true);
  if (error) return empty;

  const all = (data ?? []) as SubscriptionRow[];
  const rows = all.slice(0, MAX_SENDS_PER_INVOCATION);
  const payload = JSON.stringify(notification);
  const result: FanOutResult = { sent: 0, pruned: 0, failed: 0, skipped: all.length - rows.length };
  if (result.skipped > 0) {
    console.warn('push_fan_out_truncated', { total: all.length, sent: rows.length });
  }
  const now = new Date().toISOString();

  const gone: string[] = [];
  const succeeded: string[] = [];
  const failures: SubscriptionRow[] = [];

  // Batched rather than one at a time: 300 sequential round trips would take
  // most of a minute, and a notification that arrives after the session starts
  // is worse than useless.
  for (let start = 0; start < rows.length; start += CONCURRENCY) {
    const batch = rows.slice(start, start + CONCURRENCY);
    const outcomes = await Promise.all(batch.map((row) => sendPush(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      payload,
      config,
    )));

    outcomes.forEach((outcome, index) => {
      const row = batch[index];
      if (outcome.ok) { result.sent += 1; succeeded.push(row.id); return; }
      if (outcome.gone) { result.pruned += 1; gone.push(row.id); return; }
      result.failed += 1;
      failures.push(row);
    });
  }

  // Three bulk updates rather than one per subscription, which would triple the
  // subrequests this costs.
  if (succeeded.length > 0) {
    await sb.from('push_subscriptions')
      .update({ last_success_at: now, failure_count: 0 })
      .in('id', succeeded);
  }
  if (gone.length > 0) {
    // The browser is gone, the user cleared site data, or the endpoint rotated.
    // Retrying forever is how a send loop becomes all dead endpoints.
    await sb.from('push_subscriptions').update({ revoked_at: now }).in('id', gone);
  }
  for (const row of failures) {
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
  ctx: ExecutionContext,
  env: Env,
  sb: SupabaseClient,
  attendeeIds: readonly string[],
  category: PushCategory,
  notification: Notification,
): void {
  // waitUntil, not a bare promise. A Worker may be terminated as soon as it
  // returns a response, so fire-and-forget work is cancelled mid-flight -- which
  // would have meant promotions and incident notices silently not sending.
  ctx.waitUntil(
    notifyAttendees(env, sb, attendeeIds, category, notification)
      .catch((error) => console.error('push_fan_out_failed', error)),
  );
}
