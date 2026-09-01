// Starred sessions, mirrored from the phone.
//
// My Day works without any of this — it is a localStorage set, and an attendee
// who never pairs keeps their list. What pairing adds is a reminder: the cron
// cannot read a phone, so a paired device sends its stars up and the reminder
// job reads them here.
//
// Nothing in here is gated on check-in the way booking is. A seat is scarce and
// has to be earned by turning up; a star holds nothing and costs nobody
// anything, so the gate would only be theatre.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { authenticateDevice, type DeviceIdentity } from './attendee-auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A phone can hold a long list, but not an unbounded one. */
const MAX_MERGE_ITEMS = 500;

async function requireDevice(
  req: Request,
  sb: SupabaseClient,
): Promise<DeviceIdentity | Response> {
  const auth = await authenticateDevice(req, sb);
  if (auth.ok) return auth.identity;
  const status = auth.error === 'query_failed' ? 503 : 401;
  return jsonResponse({ error: auth.error }, status);
}

async function listSaved(sb: SupabaseClient, attendeeId: string): Promise<string[] | null> {
  const { data, error } = await sb
    .from('saved_items')
    .select('schedule_item_id')
    .eq('attendee_id', attendeeId);
  if (error) return null;
  return ((data ?? []) as Array<{ schedule_item_id: string }>).map((row) => row.schedule_item_id);
}

export async function handleMySaved(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  const saved = await listSaved(sb, identity.attendee_id);
  if (saved === null) return jsonResponse({ error: 'query_failed' }, 500);
  return jsonResponse({ saved });
}

export async function handleSaveItem(
  req: Request,
  env: Env,
  scheduleItemId: string,
): Promise<Response> {
  if (!UUID.test(scheduleItemId)) return jsonResponse({ error: 'invalid_session' }, 400);

  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  // Ignoring a conflict rather than reporting one: the app fires on every tap,
  // and a star that is already there is the outcome the tap wanted anyway.
  const { error } = await sb
    .from('saved_items')
    .upsert(
      { attendee_id: identity.attendee_id, schedule_item_id: scheduleItemId },
      { onConflict: 'attendee_id,schedule_item_id', ignoreDuplicates: true },
    );
  // A star pointing at a session that no longer exists is the app being stale,
  // not the attendee doing anything wrong.
  if (error) {
    const status = error.code === '23503' ? 404 : 500;
    return jsonResponse({ error: status === 404 ? 'session_not_found' : 'save_failed' }, status);
  }
  return jsonResponse({ saved: true });
}

export async function handleUnsaveItem(
  req: Request,
  env: Env,
  scheduleItemId: string,
): Promise<Response> {
  if (!UUID.test(scheduleItemId)) return jsonResponse({ error: 'invalid_session' }, 400);

  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  const { error } = await sb
    .from('saved_items')
    .delete()
    .eq('attendee_id', identity.attendee_id)
    .eq('schedule_item_id', scheduleItemId);
  if (error) return jsonResponse({ error: 'save_failed' }, 500);
  return jsonResponse({ saved: false });
}

/**
 * Folds a phone's local list into the server's, and returns the union.
 *
 * Called once when a device pairs, because everything starred before pairing —
 * which is most of it, since people plan their weekend before they arrive —
 * exists only on that phone. A union rather than a replace: someone pairing a
 * second device must not wipe what they starred on the first.
 */
export async function handleMergeSaved(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  let body: { schedule_item_ids?: unknown };
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_body' }, 400); }

  const raw = Array.isArray(body.schedule_item_ids) ? body.schedule_item_ids : null;
  if (!raw) return jsonResponse({ error: 'invalid_body' }, 400);
  if (raw.length > MAX_MERGE_ITEMS) return jsonResponse({ error: 'too_many_items' }, 400);

  const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && UUID.test(id)))];

  if (ids.length > 0) {
    // Only sessions that exist: a stale phone can hold ids for items deleted
    // since, and one of those would fail the whole insert on the foreign key.
    const known = await sb.from('schedule_items').select('id').in('id', ids);
    if (known.error) return jsonResponse({ error: 'query_failed' }, 500);
    const live = ((known.data ?? []) as Array<{ id: string }>).map((row) => row.id);

    if (live.length > 0) {
      const { error } = await sb
        .from('saved_items')
        .upsert(
          live.map((id) => ({ attendee_id: identity.attendee_id, schedule_item_id: id })),
          { onConflict: 'attendee_id,schedule_item_id', ignoreDuplicates: true },
        );
      if (error) return jsonResponse({ error: 'save_failed' }, 500);
    }
  }

  const saved = await listSaved(sb, identity.attendee_id);
  if (saved === null) return jsonResponse({ error: 'query_failed' }, 500);
  return jsonResponse({ saved });
}
