// Which sessions on the events board belong to one member of staff.
//
// Every other answer in this admin is a page: a prefix in `roles.ts` says yes
// or no and the handler never thinks about it again. `event_manager` is the
// first grant that is rows — somebody brought in to run two tournaments, who
// should see those two and change those two and have no opinion available
// about anybody else's.
//
// A prefix cannot say that, so the route map lets an event manager reach the
// board and this decides what "the board" is for them. The scope is a set of
// schedule item ids, or `null` meaning "no restriction" — which is what the
// admin roles and every desk role get, and what the board has always been.
import type { SupabaseClient } from '@supabase/supabase-js';
import { carriesReadFloor, type StaffMember } from './roles';

/** A restriction, or null for none. `null` and the empty set are not the same. */
export type EventScope = ReadonlySet<string> | null;

/** Sessions this person is named on, whether or not the role needs it. */
async function assignedEventIds(sb: SupabaseClient, email: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from('staff_events')
    .select('schedule_item_id')
    .eq('staff_email', email.toLowerCase());
  // A failed read must not widen anybody: an empty set shows them nothing,
  // which is recoverable, where a null would hand them the whole edition.
  if (error) return new Set();
  return new Set(((data ?? []) as { schedule_item_id: string }[]).map((row) => row.schedule_item_id));
}

function isScopedManager(roles: readonly string[]): boolean {
  if (roles.includes('admin') || roles.includes('basic_admin')) return false;
  return roles.includes('event_manager');
}

/**
 * Both answers, from one lookup.
 *
 * They are different questions and only sometimes the same answer:
 *
 * - **read** is unrestricted for anybody who carries the read-only floor. A
 *   volunteer who runs a tournament *and* works the check-in desk already reads
 *   every booking in the edition through the desk, and must not be made blinder
 *   by gaining a second role.
 * - **write** is their own sessions whenever they are a scoped manager, desk or
 *   no desk. Holding a desk widens what they look at and must never widen what
 *   they rewrite.
 *
 * So the board can be wider than the part of it they may change, which is why
 * `handleEventsOverview` marks each session rather than the payload.
 */
export async function eventScopes(
  sb: SupabaseClient,
  staff: StaffMember,
): Promise<{ read: EventScope; write: EventScope }> {
  if (!isScopedManager(staff.roles)) return { read: null, write: null };
  const mine = await assignedEventIds(sb, staff.email);
  return { read: carriesReadFloor(staff.roles) ? null : mine, write: mine };
}

/** What this person may change, for the two routes that only write. */
export async function eventWriteScope(sb: SupabaseClient, staff: StaffMember): Promise<EventScope> {
  return (await eventScopes(sb, staff)).write;
}

/** Whether a scope allows this session. A null scope allows everything. */
export function scopeAllows(scope: EventScope, scheduleItemId: string): boolean {
  return scope === null || scope.has(scheduleItemId);
}
