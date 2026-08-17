import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { sanitizePhone } from '../validation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleUserList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  // Restrict to alphanumerics + spaces so q can't inject PostgREST .or() grammar
  // (commas/parens/*) into the filter string below. Names are letters/spaces, phones digits.
  const q = (params.get('q') || '').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);

  let query = sb
    .from('users')
    .select('phone, name, email, notes, created_at, registrations(count)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);
  if (q) query = query.or(`phone.ilike.%${q}%,name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const users = rows.slice(0, limit).map((u: any) => ({
    phone: u.phone,
    name: u.name,
    email: u.email,
    notes: u.notes,
    created_at: u.created_at,
    registration_count: Array.isArray(u.registrations) && u.registrations[0] ? u.registrations[0].count : 0,
  }));
  return adminJson({ users, has_more: hasMore, offset, limit }, 200, origin);
}

export async function handleUserGet(env: Env, sb: SupabaseClient, phone: string, origin: string): Promise<Response> {
  const { data, error } = await sb
    .from('users')
    .select('*, registrations(*, editions(slug, name)), orders(*)')
    .eq('phone', phone)
    .maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ user: data }, 200, origin);
}

export async function handleUserPatch(req: Request, env: Env, sb: SupabaseClient, phone: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('users').select('phone, name, email, notes').eq('phone', phone).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const patch: any = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (name.length > 120) return adminJson({ error: 'invalid_name' }, 400, origin);
    patch.name = name || null;
  }
  if (typeof body.email === 'string') {
    const userEmail = body.email.trim().toLowerCase();
    if (userEmail && (userEmail.length > 254 || !EMAIL_RE.test(userEmail))) {
      return adminJson({ error: 'invalid_email' }, 400, origin);
    }
    patch.email = userEmail || null;
  }
  if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null;
  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('users').update(patch).eq('phone', phone).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(before.data as any, { ...(before.data as any), ...patch });
  await writeAudit(sb, { actor_email: email, action: 'user.update', target_table: 'users', target_id: phone, diff });
  return adminJson({ ok: true, user: upd.data }, 200, origin);
}

export async function handleUserChangePhone(req: Request, env: Env, sb: SupabaseClient, oldPhone: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const newPhone = sanitizePhone(body.phone);
  if (!newPhone || newPhone.length !== 10) return adminJson({ error: 'invalid_phone' }, 400, origin);
  if (newPhone === oldPhone) return adminJson({ error: 'same_phone' }, 400, origin);

  const exists = await sb.from('users').select('phone').eq('phone', oldPhone).maybeSingle();
  if (exists.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!exists.data) return adminJson({ error: 'not_found' }, 404, origin);
  const taken = await sb.from('users').select('phone').eq('phone', newPhone).maybeSingle();
  if (taken.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (taken.data) return adminJson({ error: 'phone_taken' }, 409, origin);

  const upd = await sb.from('users').update({ phone: newPhone }).eq('phone', oldPhone).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  await writeAudit(sb, { actor_email: email, action: 'user.phone_change', target_table: 'users', target_id: newPhone, diff: { phone: { old: oldPhone, new: newPhone } } });
  return adminJson({ ok: true, phone: newPhone }, 200, origin);
}
