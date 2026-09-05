import type { Role } from './whoami';

/** Kept in step with `worker/src/admin/roles.ts`; the Worker is the authority. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Full admin',
  basic_admin: 'Basic admin',
  check_in: 'Check-in desk',
  library: 'Game library',
  programme: 'Programme & notices',
};

export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Everything, including this page',
  basic_admin: 'Everything except this page — cannot change who has access',
  check_in: 'Check people in, issue app codes, session rosters',
  library: 'Lend and take back games',
  programme: 'Edit the schedule and send notices',
};

export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

/**
 * Which roles each role already contains.
 *
 * Only the two umbrella roles contain anything. The desk roles are siblings:
 * the library desk is not a superset of check-in, so somebody can hold both
 * and frequently does.
 */
const COVERS: Record<Role, readonly Role[]> = {
  admin: ['basic_admin', 'check_in', 'library', 'programme'],
  basic_admin: ['check_in', 'library', 'programme'],
  check_in: [],
  library: [],
  programme: [],
};

/** Whether holding `outer` already means holding `inner`. */
function covers(outer: Role, inner: Role): boolean {
  return outer === inner || COVERS[outer].includes(inner);
}

/**
 * Turns a role on or off, dropping anything the result makes redundant.
 *
 * Two roles cannot sit together when one contains the other, and the rule runs
 * both ways: picking a desk while holding Full admin drops the admin, because
 * the obvious reading of that click is "narrow this person down" — and picking
 * Full admin drops the desks, because they add nothing to it. Leaving both
 * ticked would show a permission set that does not mean what it appears to.
 *
 * Siblings are untouched: check-in plus library is a real combination, not a
 * contradiction.
 */
export function reconcileRoles(current: readonly Role[], toggled: Role): Role[] {
  if (current.includes(toggled)) return current.filter((role) => role !== toggled);

  const kept = current.filter((role) => !covers(toggled, role) && !covers(role, toggled));
  return [...kept, toggled];
}

/** Whether two role sets are the same, ignoring order. */
export function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((role, index) => role === right[index]);
}

/** Roles in a stable order, so a saved set and a draft compare by eye. */
export function orderRoles(roles: readonly Role[]): Role[] {
  return ALL_ROLES.filter((role) => roles.includes(role));
}
