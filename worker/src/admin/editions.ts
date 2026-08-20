import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { readPricing, type Pricing } from '../pricing';

const STATUSES = ['upcoming', 'open', 'sold_out', 'closed'];

function readCapacity(input: unknown, requireTwoDays: boolean): Record<string, number> {
  if (!input || typeof input !== 'object') throw new Error('capacity: not an object');
  const c = input as any;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) {
    if (!Number.isFinite(v) || (v as number) < 0) throw new Error(`capacity: ${k} must be a non-negative number`);
    out[k] = v as number;
  }
  if (!Number.isFinite(out.day1)) throw new Error('capacity: day1 required as a non-negative number');
  if (requireTwoDays) {
    const keys = Object.keys(out).sort();
    if (keys.length !== 2 || keys[0] !== 'day1' || keys[1] !== 'day2') {
      throw new Error('capacity: active editions require day1 and day2 only');
    }
  }
  return out;
}

function assertFinitePricing(p: Pricing) {
  const vals = [p.oneshot, p.adventurer_cap];
  if (p.campaign !== null) vals.push(p.campaign);
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('pricing: all values must be finite, non-negative numbers');
}

function isTwoConsecutiveDays(start: string, end: string): boolean {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs === 86_400_000;
}

function readTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function assertActiveEditionShape(start: string, end: string, status: string, pricing: Pricing, capacity: Record<string, number>) {
  if (status === 'closed') return;
  if (!isTwoConsecutiveDays(start, end)) throw new Error('active editions require two consecutive days');
  if (pricing.campaign === null) {
    throw new Error('active editions require one-day and two-day prices');
  }
  readCapacity(capacity, true);
}

export async function handleEdList(env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const { data, error } = await sb.from('editions').select('*').order('start_date', { ascending: false });
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  try {
    const editions = (data ?? []).map((edition: any) => ({ ...edition, pricing: readPricing(edition.pricing) }));
    return adminJson({ editions }, 200, origin);
  } catch {
    return adminJson({ error: 'invalid_pricing_data' }, 500, origin);
  }
}

export async function handleEdCreate(req: Request, env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!/^[a-z0-9-]+$/.test(slug)) return adminJson({ error: 'invalid_slug' }, 400, origin);
  if (!name) return adminJson({ error: 'invalid_name' }, 400, origin);
  if (typeof body.start_date !== 'string' || typeof body.end_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)
    || body.end_date < body.start_date)
    return adminJson({ error: 'invalid_dates' }, 400, origin);
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  if (!venue) return adminJson({ error: 'invalid_venue' }, 400, origin);
  const dailyStartTime = readTime(body.daily_start_time);
  const dailyEndTime = readTime(body.daily_end_time);
  if (!dailyStartTime || !dailyEndTime || dailyEndTime <= dailyStartTime) {
    return adminJson({ error: 'invalid_daily_times' }, 400, origin);
  }
  const status = STATUSES.includes(body.registration_status) ? body.registration_status : 'upcoming';
  let pricing: Pricing, capacity: Record<string, number>;
  try {
    pricing = readPricing(body.pricing);
    assertFinitePricing(pricing);
    capacity = readCapacity(body.capacity_per_day, status !== 'closed');
    assertActiveEditionShape(body.start_date, body.end_date, status, pricing, capacity);
  }
  catch (e: any) { return adminJson({ error: e.message }, 400, origin); }

  const taken = await sb.from('editions').select('id').eq('slug', slug).maybeSingle();
  if (taken.data) return adminJson({ error: 'slug_taken' }, 409, origin);

  const ins = await sb.from('editions').insert({
    slug, name, start_date: body.start_date, end_date: body.end_date,
    daily_start_time: dailyStartTime, daily_end_time: dailyEndTime, venue,
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
  if (typeof body.start_date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) return adminJson({ error: 'invalid_start_date' }, 400, origin);
    patch.start_date = body.start_date;
  }
  if (typeof body.end_date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) return adminJson({ error: 'invalid_end_date' }, 400, origin);
    patch.end_date = body.end_date;
  }
  const sd = patch.start_date ?? prev.start_date;
  const ed = patch.end_date ?? prev.end_date;
  if (ed < sd) return adminJson({ error: 'invalid_dates' }, 400, origin);
  if (body.daily_start_time !== undefined) {
    const value = readTime(body.daily_start_time);
    if (!value) return adminJson({ error: 'invalid_daily_start_time' }, 400, origin);
    patch.daily_start_time = value;
  }
  if (body.daily_end_time !== undefined) {
    const value = readTime(body.daily_end_time);
    if (!value) return adminJson({ error: 'invalid_daily_end_time' }, 400, origin);
    patch.daily_end_time = value;
  }
  if ((patch.daily_end_time ?? prev.daily_end_time) <= (patch.daily_start_time ?? prev.daily_start_time)) {
    return adminJson({ error: 'invalid_daily_times' }, 400, origin);
  }
  if (typeof body.venue === 'string') {
    if (!body.venue.trim()) return adminJson({ error: 'invalid_venue' }, 400, origin);
    patch.venue = body.venue.trim();
  }
  if (body.pricing !== undefined) { try { const pr = readPricing(body.pricing); assertFinitePricing(pr as any); patch.pricing = pr; } catch (e: any) { return adminJson({ error: e.message }, 400, origin); } }
  if (body.capacity_per_day !== undefined) { try { patch.capacity_per_day = readCapacity(body.capacity_per_day, false); } catch (e: any) { return adminJson({ error: e.message }, 400, origin); } }
  if (STATUSES.includes(body.registration_status)) patch.registration_status = body.registration_status;
  if (typeof body.is_current === 'boolean') patch.is_current = body.is_current;
  if (typeof body.is_published === 'boolean') patch.is_published = body.is_published;

  try {
    assertActiveEditionShape(
      sd,
      ed,
      patch.registration_status ?? prev.registration_status,
      readPricing(patch.pricing ?? prev.pricing),
      (patch.capacity_per_day ?? prev.capacity_per_day) as Record<string, number>,
    );
  } catch (e: any) {
    return adminJson({ error: e.message }, 400, origin);
  }

  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('editions').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(prev, { ...prev, ...patch });
  await writeAudit(sb, { actor_email: email, action: 'edition.update', target_table: 'editions', target_id: id, diff });
  return adminJson({ ok: true, edition: upd.data }, 200, origin);
}
