import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { readPricing } from '../pricing';

const STATUSES = ['upcoming', 'open', 'sold_out', 'closed'];

function readCapacity(input: unknown): { day1: number; day2: number } {
  if (!input || typeof input !== 'object') throw new Error('capacity: not an object');
  const c = input as any;
  if (typeof c.day1 !== 'number' || typeof c.day2 !== 'number') throw new Error('capacity: day1/day2 required as numbers');
  return { day1: c.day1, day2: c.day2 };
}

export async function handleEdList(env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const { data, error } = await sb.from('editions').select('*').order('start_date', { ascending: false });
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ editions: data ?? [] }, 200, origin);
}

export async function handleEdCreate(req: Request, env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!/^[a-z0-9-]+$/.test(slug)) return adminJson({ error: 'invalid_slug' }, 400, origin);
  if (!name) return adminJson({ error: 'invalid_name' }, 400, origin);
  if (typeof body.start_date !== 'string' || typeof body.end_date !== 'string' || body.end_date < body.start_date)
    return adminJson({ error: 'invalid_dates' }, 400, origin);
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  let pricing: unknown, capacity: unknown;
  try { pricing = readPricing(body.pricing); capacity = readCapacity(body.capacity_per_day); }
  catch (e: any) { return adminJson({ error: e.message }, 400, origin); }
  const status = STATUSES.includes(body.registration_status) ? body.registration_status : 'upcoming';

  const taken = await sb.from('editions').select('id').eq('slug', slug).maybeSingle();
  if (taken.data) return adminJson({ error: 'slug_taken' }, 409, origin);

  const ins = await sb.from('editions').insert({
    slug, name, start_date: body.start_date, end_date: body.end_date, venue,
    pricing, capacity_per_day: capacity, registration_status: status,
    is_current: body.is_current === true, is_published: body.is_published === true,
  }).select().single();
  if (ins.error || !ins.data) return adminJson({ error: 'insert_failed' }, 500, origin);

  await writeAudit(sb, { actor_email: email, action: 'edition.create', target_table: 'editions', target_id: (ins.data as any).id, diff: ins.data });
  return adminJson({ ok: true, edition: ins.data }, 200, origin);
}

export async function handleEdPatch(req: Request, env: Env, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('editions').select('*').eq('id', id).maybeSingle();
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);
  const prev = before.data as any;

  const patch: any = {};
  if (typeof body.name === 'string') { if (!body.name.trim()) return adminJson({ error: 'invalid_name' }, 400, origin); patch.name = body.name.trim(); }
  if (typeof body.slug === 'string') {
    const s = body.slug.trim();
    if (!/^[a-z0-9-]+$/.test(s)) return adminJson({ error: 'invalid_slug' }, 400, origin);
    const taken = await sb.from('editions').select('id').eq('slug', s).maybeSingle();
    if (taken.data && (taken.data as any).id !== id) return adminJson({ error: 'slug_taken' }, 409, origin);
    patch.slug = s;
  }
  if (typeof body.start_date === 'string') patch.start_date = body.start_date;
  if (typeof body.end_date === 'string') patch.end_date = body.end_date;
  const sd = patch.start_date ?? prev.start_date;
  const ed = patch.end_date ?? prev.end_date;
  if (ed < sd) return adminJson({ error: 'invalid_dates' }, 400, origin);
  if (typeof body.venue === 'string') patch.venue = body.venue.trim();
  if (body.pricing !== undefined) { try { patch.pricing = readPricing(body.pricing); } catch (e: any) { return adminJson({ error: e.message }, 400, origin); } }
  if (body.capacity_per_day !== undefined) { try { patch.capacity_per_day = readCapacity(body.capacity_per_day); } catch (e: any) { return adminJson({ error: e.message }, 400, origin); } }
  if (STATUSES.includes(body.registration_status)) patch.registration_status = body.registration_status;
  if (typeof body.is_current === 'boolean') patch.is_current = body.is_current;
  if (typeof body.is_published === 'boolean') patch.is_published = body.is_published;

  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('editions').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(prev, { ...prev, ...patch });
  await writeAudit(sb, { actor_email: email, action: 'edition.update', target_table: 'editions', target_id: id, diff });
  return adminJson({ ok: true, edition: upd.data }, 200, origin);
}
