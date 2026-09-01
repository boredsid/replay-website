import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { diffRows, writeAudit } from './audit';
import { notifyAnnouncement } from '../push-triggers';
import type { Env } from '../index';

const SEVERITIES = ['info', 'urgent', 'incident'] as const;
const AUDIENCES = ['all', 'day1', 'day2'] as const;

type AnnouncementInput = {
  edition_id: string;
  title: string;
  body: string;
  severity: typeof SEVERITIES[number];
  audience: typeof AUDIENCES[number];
  starts_at: string;
  ends_at: string | null;
  is_published: boolean;
};

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function timestamp(value: unknown, field: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid_${field}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid_${field}`);
  return parsed.toISOString();
}

function parseAnnouncement(input: any, previous?: any): AnnouncementInput {
  const merged = { ...(previous ?? {}), ...(input ?? {}) };
  const editionId = requiredText(merged.edition_id, 100, 'edition_id');
  const severity = SEVERITIES.includes(merged.severity) ? merged.severity : null;
  const audience = AUDIENCES.includes(merged.audience) ? merged.audience : null;
  if (!severity) throw new Error('invalid_severity');
  if (!audience) throw new Error('invalid_audience');
  if (typeof merged.is_published !== 'boolean') throw new Error('invalid_is_published');

  const startsAt = timestamp(merged.starts_at, 'starts_at') as string;
  const endsAt = timestamp(merged.ends_at, 'ends_at', true);
  if (endsAt && endsAt <= startsAt) throw new Error('invalid_delivery_window');

  return {
    edition_id: editionId,
    title: requiredText(merged.title, 120, 'title'),
    body: requiredText(merged.body, 2000, 'body'),
    severity,
    audience,
    starts_at: startsAt,
    ends_at: endsAt,
    is_published: merged.is_published,
  };
}

async function editionExists(sb: SupabaseClient, editionId: string): Promise<boolean | null> {
  const result = await sb.from('editions').select('id').eq('id', editionId).maybeSingle();
  if (result.error) return null;
  return Boolean(result.data);
}

export async function handleAnnouncementList(req: Request, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const editionId = params.get('edition_id')?.trim() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);

  let query = sb
    .from('announcements')
    .select('*')
    .eq('edition_id', editionId)
    .order('starts_at', { ascending: false });

  const severity = params.get('severity');
  if (SEVERITIES.includes(severity as typeof SEVERITIES[number])) query = query.eq('severity', severity);

  const result = await query;
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ announcements: result.data ?? [] }, 200, origin);
}

export async function handleAnnouncementGet(sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const result = await sb.from('announcements').select('*').eq('id', id).maybeSingle();
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!result.data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ announcement: result.data }, 200, origin);
}

export async function handleAnnouncementCreate(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  let row: AnnouncementInput;
  try {
    row = parseAnnouncement({
      severity: 'info',
      audience: 'all',
      starts_at: new Date().toISOString(),
      ends_at: null,
      is_published: false,
      ...body,
    });
  } catch (error: any) {
    return adminJson({ error: error.message }, 400, origin);
  }

  const exists = await editionExists(sb, row.edition_id);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  const inserted = await sb.from('announcements').insert(row).select().single();
  if (inserted.error || !inserted.data) return adminJson({ error: 'insert_failed' }, 500, origin);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'announcement.create',
    target_table: 'announcements',
    target_id: (inserted.data as any).id,
    diff: inserted.data,
  });

  // Only a published urgent or incident notice buzzes anybody. A draft has not
  // been decided on yet, and routine news is what makes people switch a channel
  // off before the notice that matters arrives.
  if (row.is_published) {
    ctx.waitUntil(
      notifyAnnouncement(env, sb, inserted.data as never, row.edition_id)
        .catch((error) => console.error('announcement_push_failed', error)),
    );
  }

  return adminJson({ ok: true, announcement: inserted.data }, 200, origin);
}

export async function handleAnnouncementPatch(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('announcements').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  let row: AnnouncementInput;
  try { row = parseAnnouncement(body, before.data); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  const exists = await editionExists(sb, row.edition_id);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  const updated = await sb.from('announcements').update(row).eq('id', id).select().single();
  if (updated.error || !updated.data) return adminJson({ error: 'update_failed' }, 500, origin);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'announcement.update',
    target_table: 'announcements',
    target_id: id,
    diff: diffRows(before.data as any, { ...(before.data as any), ...row }),
  });

  // Only on the transition into published. Editing an already-published notice
  // must not buzz everybody again -- fixing a typo is not news.
  const wasPublished = (before.data as { is_published: boolean }).is_published;
  if (row.is_published && !wasPublished) {
    ctx.waitUntil(
      notifyAnnouncement(env, sb, updated.data as never, row.edition_id)
        .catch((error) => console.error('announcement_push_failed', error)),
    );
  }

  return adminJson({ ok: true, announcement: updated.data }, 200, origin);
}

/**
 * DELETE /api/admin/announcements/:id — for a notice that should not have gone
 * out at all: a duplicate, a wrong edition, a test. Unpublishing already hides
 * a live notice from the app, so deleting is about tidying the list rather
 * than about recall; a push that has already buzzed a phone cannot be taken
 * back either way. The audit row keeps the deleted text.
 */
export async function handleAnnouncementDelete(
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const before = await sb.from('announcements').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const deleted = await sb.from('announcements').delete().eq('id', id);
  if (deleted.error) return adminJson({ error: 'delete_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'announcement.delete',
    target_table: 'announcements',
    target_id: id,
    diff: before.data,
  });
  return adminJson({ ok: true }, 200, origin);
}
