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

export type Role = 'admin' | 'basic_admin' | 'read_only' | 'check_in' | 'library' | 'programme';

export const ROLES: readonly Role[] = ['admin', 'basic_admin', 'read_only', 'check_in', 'library', 'programme'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Full admin',
  basic_admin: 'Basic admin',
  read_only: 'Read only',
  check_in: 'Check-in desk',
  library: 'Game library',
  programme: 'Programme and notices',
};

/**
 * The one real privilege boundary.
 *
 * Everything else is a question of which desk somebody works. This is the
 * question of whether they can make themselves anything else — a role that can
 * edit the staff table can grant itself every other role, so `basic_admin` is
 * exactly "full admin, minus that".
 */
const STAFF_PREFIX = '/api/admin/staff';

/**
 * Paths a basic admin does not reach either — full admins only.
 *
 * Deliberately short, and it should stay that way: the difference between the
 * two admin roles is meant to be one boundary, not a growing list of
 * exceptions somebody has to hold in their head. A path earns a place here by
 * handing over something a basic admin has no other route to.
 *
 * The arrivals list is the second entry. Everywhere else in the admin, an
 * attendee's phone number is either masked or attached to the one booking
 * somebody is looking at; that endpoint is the whole building's numbers in
 * full, in one response, which is a different kind of object.
 */
const ADMIN_ONLY: readonly string[] = [
  STAFF_PREFIX,
  '/api/admin/check-in/arrivals',
];

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
  { prefix: '/api/admin/whoami', roles: ['read_only', 'check_in', 'library', 'programme'] },

  // The desk. Roster and search are how somebody is found at the door.
  { prefix: '/api/admin/check-in', roles: ['check_in'] },
  // Except the arrivals list, which is every attendee's number in full. Empty
  // rather than absent: the desk's prefix above would otherwise swallow it, and
  // an explicit empty rule says "classified, and the answer is nobody" where a
  // missing one would only mean nobody had looked. See ADMIN_ONLY, which keeps
  // a basic admin out of it too.
  { prefix: '/api/admin/check-in/arrivals', roles: [] },
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
 * What every signed-in member of staff may read, whatever desk they work.
 *
 * Read-only, and only on GET. Somebody on the door needs to see the programme
 * and look a booking up without being able to rewrite either — and a volunteer
 * who cannot see what is happening is a volunteer who asks somebody else.
 *
 * This list is what the `read_only` role is: it holds nothing else, so adding
 * a prefix here widens that role by exactly one page. Do it deliberately.
 *
 * `handleRegList` and `handleRegGet` additionally redact what a read-only
 * viewer gets: money and full phone numbers are not needed to answer a
 * question, and a sheet of both is a thing to lose.
 */
const READABLE_BY_ALL: readonly string[] = [
  '/api/admin/schedule',
  '/api/admin/sessions',
  '/api/admin/announcements',
  '/api/admin/registrations',
  // The events board. Deliberately absent from RULES above, so the only people
  // who may change a booking from it are the two admin roles -- a desk role
  // reads it here and writes through the session roster it already owns.
  '/api/admin/events',
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

/** Full access: may change this, not merely look at it. */
export function hasFullAccess(roles: readonly string[], path: string): boolean {
  if (roles.includes('admin')) return true;
  if (roles.includes('basic_admin')) return !ADMIN_ONLY.some((prefix) => path.startsWith(prefix));
  return rolesForPath(path).some((role) => roles.includes(role));
}

/**
 * Whether these roles may make this request.
 *
 * The method matters now: read-only access is exactly "GET and nothing else",
 * so a page somebody can look at cannot become a page they can change by
 * finding the right button.
 */
export function mayReach(roles: readonly string[], path: string, method = 'GET'): boolean {
  if (hasFullAccess(roles, path)) return true;
  if (method !== 'GET') return false;
  return READABLE_BY_ALL.some((prefix) => path.startsWith(prefix));
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
