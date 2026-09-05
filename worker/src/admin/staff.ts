// Managing who may do what, from the admin app.
//
// Every route here is admin-only by omission: `rolesForPath` has no rule for
// `/api/admin/staff`, so nothing but the `admin` role reaches it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';
import { ROLES, type Role } from './roles';
import { syncAccessFromStaff, type SyncOutcome } from './access-group';
import type { Env } from '../index';

/**
 * The staff table is the authority, so it is written first and a failed Access
 * sync is reported rather than rolled back. The other way round would mean a
 * Cloudflare outage could stop you changing who works your own desk.
 */
function withSync(body: Record<string, unknown>, sync: SyncOutcome): Record<string, unknown> {
  return { ...body, access_sync: sync };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanRoles(input: unknown): Role[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const roles = [...new Set(input)];
  if (!roles.every((role): role is Role => typeof role === 'string' && (ROLES as readonly string[]).includes(role))) {
    return null;
  }
  return roles;
}

/** Maps the database's own guards onto something the screen can word. */
function staffError(message: string): { error: string; status: number } {
  if (message.includes('last_admin')) return { error: 'last_admin', status: 409 };
  if (message.includes('staff_roles_known')) return { error: 'unknown_role', status: 400 };
  if (message.includes('staff_email_lowercase') || message.includes('staff_email_shaped')) {
    return { error: 'invalid_email', status: 400 };
  }
  if (message.includes('staff_has_a_role')) return { error: 'no_roles', status: 400 };
  if (message.includes('duplicate key')) return { error: 'already_staff', status: 409 };
  return { error: 'request_failed', status: 500 };
}

export async function handleStaffList(sb: SupabaseClient, origin: string): Promise<Response> {
  const { data, error } = await sb
    .from('staff')
    .select('email, name, roles, added_by, created_at')
    .order('created_at');
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ staff: data ?? [] }, 200, origin);
}

export async function handleStaffCreate(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { email?: unknown; name?: unknown; roles?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) return adminJson({ error: 'invalid_email' }, 400, origin);

  const roles = cleanRoles(body.roles);
  if (!roles) return adminJson({ error: 'no_roles' }, 400, origin);

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;

  const { error } = await sb.from('staff').insert({ email, name, roles, added_by: actorEmail });
  if (error) {
    const mapped = staffError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'staff.add',
    target_table: 'staff',
    target_id: email,
    diff: { roles, name },
  });
  return adminJson(withSync({ ok: true }, await syncAccessFromStaff(env, sb)), 200, origin);
}

export async function handleStaffUpdate(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  target: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { roles?: unknown; name?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const email = target.trim().toLowerCase();
  const roles = cleanRoles(body.roles);
  if (!roles) return adminJson({ error: 'no_roles' }, 400, origin);

  // Losing your own admin is the one mistake nobody can undo from this screen,
  // so it is refused here rather than left to the database's last-admin rule —
  // which would allow it as long as somebody else happened to be an admin.
  if (email === actorEmail.toLowerCase() && !roles.includes('admin')) {
    return adminJson({ error: 'cannot_demote_self' }, 409, origin);
  }

  const patch: Record<string, unknown> = { roles };
  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 120) || null;

  const { data, error } = await sb.from('staff').update(patch).eq('email', email).select('email');
  if (error) {
    const mapped = staffError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }
  if (!data || data.length === 0) return adminJson({ error: 'not_found' }, 404, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'staff.update',
    target_table: 'staff',
    target_id: email,
    diff: { roles },
  });
  return adminJson({ ok: true }, 200, origin);
}

export async function handleStaffRemove(
  env: Env,
  sb: SupabaseClient,
  target: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const email = target.trim().toLowerCase();
  if (email === actorEmail.toLowerCase()) {
    return adminJson({ error: 'cannot_remove_self' }, 409, origin);
  }

  const { data, error } = await sb.from('staff').delete().eq('email', email).select('email');
  if (error) {
    const mapped = staffError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }
  if (!data || data.length === 0) return adminJson({ error: 'not_found' }, 404, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'staff.remove',
    target_table: 'staff',
    target_id: email,
    diff: {},
  });
  // Removal matters most: until Access agrees, they can still reach the door,
  // even though every route now refuses them.
  return adminJson(withSync({ ok: true }, await syncAccessFromStaff(env, sb)), 200, origin);
}
