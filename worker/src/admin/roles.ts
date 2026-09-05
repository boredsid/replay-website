// What each role is allowed to reach.
//
// Cloudflare Access answers "are you who you say you are". This answers "may
// you", which used to be a single boolean guarding all fifty-two admin routes.
//
// The map is by path prefix rather than by exact route because the alternative
// is fifty-two decisions that drift apart. A prefix says something durable —
// "the library desk" — and a route added under it inherits the answer rather
// than defaulting to open.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'admin' | 'check_in' | 'library' | 'programme';

export const ROLES: readonly Role[] = ['admin', 'check_in', 'library', 'programme'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Full admin',
  check_in: 'Check-in desk',
  library: 'Game library',
  programme: 'Programme and notices',
};

/**
 * Longest-prefix wins, so `/check-in/roster` can differ from `/check-in`.
 *
 * `admin` is not listed anywhere: it reaches everything, checked separately.
 * Anything not matched here is admin-only by omission, which is the safe
 * direction for a route somebody adds later and forgets to classify.
 */
const RULES: ReadonlyArray<{ prefix: string; roles: readonly Role[] }> = [
  // Every signed-in member of staff needs to know who they are, or the admin
  // app cannot render its own navigation.
  { prefix: '/api/admin/whoami', roles: ['check_in', 'library', 'programme'] },

  // The desk. Roster and search are how somebody is found at the door.
  { prefix: '/api/admin/check-in', roles: ['check_in'] },
  { prefix: '/api/admin/attendees', roles: ['check_in'] },

  // Scanning a pass is the first step at both counters.
  { prefix: '/api/admin/scan', roles: ['check_in', 'library'] },

  { prefix: '/api/admin/library', roles: ['library'] },

  // The programme, and the notices that go with running it.
  { prefix: '/api/admin/schedule', roles: ['programme'] },
  { prefix: '/api/admin/sessions', roles: ['programme', 'check_in'] },
  { prefix: '/api/admin/announcements', roles: ['programme'] },

  // Read-only situational awareness; no personal data beyond counts.
  { prefix: '/api/admin/dashboard', roles: ['check_in', 'library', 'programme'] },
];

/**
 * Which roles may call this path. Admin is implicit everywhere.
 *
 * An unmatched path returns an empty list, meaning admin-only — a route added
 * without a rule fails closed rather than open.
 */
export function rolesForPath(path: string): readonly Role[] {
  let best: { prefix: string; roles: readonly Role[] } | null = null;
  for (const rule of RULES) {
    if (!path.startsWith(rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best?.roles ?? [];
}

export function mayReach(roles: readonly string[], path: string): boolean {
  if (roles.includes('admin')) return true;
  const allowed = rolesForPath(path);
  return allowed.some((role) => roles.includes(role));
}

export interface StaffMember {
  email: string;
  name: string | null;
  roles: Role[];
}

/**
 * The staff row for a verified email, or null if there is not one.
 *
 * Null means signed in and not staff, which is a 403 rather than a 401: their
 * identity is fine, they simply are not on the list. Telling them to
 * authenticate again would send them round a loop that cannot help.
 */
export async function loadStaff(
  sb: SupabaseClient,
  email: string,
): Promise<StaffMember | null> {
  const { data, error } = await sb
    .from('staff')
    .select('email, name, roles')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { email: string; name: string | null; roles: Role[] };
  return { email: row.email, name: row.name, roles: row.roles ?? [] };
}
