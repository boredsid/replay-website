import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { diffRows, writeAudit } from './audit';

const SECTIONS = ['always-on', 'programme', 'playtesting', 'publisher-showcase', 'event-floor'] as const;
const KINDS = ['workshop', 'tournament', 'open-play', 'meal', 'talk', 'ttrpg', 'story-game', 'puzzle', 'quiz', 'social-game', 'playtest', 'publisher-showcase', 'booth', 'food', 'merch', 'amenity', 'special'] as const;
const SIGNUP_MODES = ['none', 'app'] as const;
const PUBLIC_STATUSES = ['draft', 'published', 'cancelled'] as const;

type ScheduleInput = {
  edition_id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  description: string | null;
  location: string | null;
  kind: typeof KINDS[number];
  section: typeof SECTIONS[number];
  is_all_day: boolean;
  host_name: string | null;
  signup_mode: typeof SIGNUP_MODES[number];
  capacity: number | null;
  public_status: typeof PUBLIC_STATUSES[number];
  display_order: number;
};

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function readTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
}


function parseSchedule(input: any, previous?: any): ScheduleInput {
  const merged = { ...(previous ?? {}), ...(input ?? {}) };
  const editionId = typeof merged.edition_id === 'string' ? merged.edition_id.trim() : '';
  const day = typeof merged.day === 'string' ? merged.day : '';
  const title = typeof merged.title === 'string' ? merged.title.trim() : '';
  if (!editionId) throw new Error('invalid_edition_id');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('invalid_day');
  if (!title || title.length > 160) throw new Error('invalid_title');

  const section = SECTIONS.includes(merged.section) ? merged.section : null;
  const kind = KINDS.includes(merged.kind) ? merged.kind : null;
  const signupMode = SIGNUP_MODES.includes(merged.signup_mode) ? merged.signup_mode : null;
  const publicStatus = PUBLIC_STATUSES.includes(merged.public_status) ? merged.public_status : null;
  if (!section) throw new Error('invalid_section');
  if (!kind) throw new Error('invalid_kind');
  if (!signupMode) throw new Error('invalid_signup_mode');
  if (!publicStatus) throw new Error('invalid_public_status');

  const isAllDay = merged.is_all_day === true;
  const startTime = isAllDay ? null : readTime(merged.start_time);
  const endTime = isAllDay ? null : readTime(merged.end_time);
  if (!isAllDay && (!startTime || !endTime || endTime <= startTime)) throw new Error('invalid_times');

  const displayOrder = Number(merged.display_order);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) throw new Error('invalid_display_order');

  // Null means no limit, which is different from a limit of zero -- and a
  // session with no capacity at all would be bookable by nobody.
  const rawCapacity = merged.capacity;
  const capacity = rawCapacity === null || rawCapacity === undefined || rawCapacity === ''
    ? null
    : Number(rawCapacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new Error('invalid_capacity');
  }
  // In-app booking without a capacity would let a room fill past what fits;
  // the whole point of the mode is that the count is enforced.
  if (signupMode === 'app' && capacity === null) throw new Error('capacity_required_for_app_signup');

  return {
    edition_id: editionId,
    day,
    start_time: startTime,
    end_time: endTime,
    title,
    description: optionalText(merged.description, 2000, 'description'),
    location: optionalText(merged.location, 160, 'location'),
    kind,
    section,
    is_all_day: isAllDay,
    host_name: optionalText(merged.host_name, 160, 'host_name'),
    signup_mode: signupMode,
    capacity,
    public_status: publicStatus,
    display_order: displayOrder,
  };
}

async function dayFallsWithinEdition(sb: SupabaseClient, editionId: string, day: string): Promise<boolean | null> {
  const result = await sb.from('editions').select('start_date, end_date').eq('id', editionId).maybeSingle();
  if (result.error) return null;
  if (!result.data) return false;
  const edition = result.data as any;
  return day >= edition.start_date && day <= edition.end_date;
}

export async function handleScheduleList(req: Request, sb: SupabaseClient, origin: string): Promise<Response> {
  const editionId = new URL(req.url).searchParams.get('edition_id')?.trim() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);
  const { data, error } = await sb
    .from('schedule_items')
    .select('*')
    .eq('edition_id', editionId)
    .order('day', { ascending: true })
    .order('section', { ascending: true })
    .order('display_order', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ items: data ?? [] }, 200, origin);
}

export async function handleScheduleGet(sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const { data, error } = await sb.from('schedule_items').select('*').eq('id', id).maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ item: data }, 200, origin);
}

export async function handleScheduleCreate(req: Request, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  let row: ScheduleInput;
  try {
    row = parseSchedule({
      section: 'programme',
      kind: 'special',
      is_all_day: false,
      signup_mode: 'none',
      capacity: null,
      public_status: 'draft',
      display_order: 0,
      ...body,
    });
  } catch (error: any) {
    return adminJson({ error: error.message }, 400, origin);
  }

  const validDay = await dayFallsWithinEdition(sb, row.edition_id, row.day);
  if (validDay === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!validDay) return adminJson({ error: 'day_outside_edition' }, 400, origin);

  const inserted = await sb.from('schedule_items').insert(row).select().single();
  if (inserted.error || !inserted.data) return adminJson({ error: 'insert_failed' }, 500, origin);
  await writeAudit(sb, { actor_email: email, action: 'schedule.create', target_table: 'schedule_items', target_id: (inserted.data as any).id, diff: inserted.data });
  return adminJson({ ok: true, item: inserted.data }, 200, origin);
}

export async function handleSchedulePatch(req: Request, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('schedule_items').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  let row: ScheduleInput;
  try { row = parseSchedule(body, before.data); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  const validDay = await dayFallsWithinEdition(sb, row.edition_id, row.day);
  if (validDay === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!validDay) return adminJson({ error: 'day_outside_edition' }, 400, origin);

  const updated = await sb.from('schedule_items').update(row).eq('id', id).select().single();
  if (updated.error || !updated.data) return adminJson({ error: 'update_failed' }, 500, origin);
  await writeAudit(sb, { actor_email: email, action: 'schedule.update', target_table: 'schedule_items', target_id: id, diff: diffRows(before.data as any, { ...(before.data as any), ...row }) });
  return adminJson({ ok: true, item: updated.data }, 200, origin);
}
