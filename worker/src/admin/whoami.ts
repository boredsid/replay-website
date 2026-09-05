import { adminJson } from './auth';
import type { StaffMember } from './roles';

/**
 * Who you are and what you may do.
 *
 * The roles are here so the admin app can hide navigation it would only get a
 * 403 from. That is presentation, not enforcement — every route checks for
 * itself, and a hidden link is not a closed door.
 */
export function handleWhoami(staff: StaffMember, origin: string): Response {
  return adminJson({ email: staff.email, name: staff.name, roles: staff.roles }, 200, origin);
}
