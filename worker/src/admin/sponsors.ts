// Admin CRUD for the homepage partner/sponsor logo wall.
//
// A sponsor row owns two things the public site reads: the artwork
// (`logo_url`, normally an object this worker uploaded to the `sponsor-logos`
// bucket and remembers as `logo_path`) and the link the logo points at
// (`website_url`, optional). Everything here is edition-scoped, like the rest
// of the console.
//
// The wall is rendered at build time, so changes here reach replaycon.in only
// after a site rebuild. The console says so; nothing in this file triggers one.
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { diffRows, writeAudit } from './audit';

export const SPONSOR_LOGO_BUCKET = 'sponsor-logos';

/** Mirrors the bucket's `allowed_mime_types`; keep the two in step. */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/** Mirrors the bucket's `file_size_limit`. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const TIERS = ['title', 'gold', 'silver', 'partner'] as const;

type SponsorTier = typeof TIERS[number];

type SponsorInput = {
  edition_id: string;
  name: string;
  tier: SponsorTier;
  logo_url: string;
  logo_path: string | null;
  website_url: string | null;
  display_order: number;
};

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function httpUrl(value: unknown, field: string): string {
  const text = requiredText(value, 1000, field);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`invalid_${field}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`invalid_${field}`);
  return url.toString();
}

function optionalHttpUrl(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return httpUrl(value, field);
}

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function displayOrder(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const order = Number(value);
  if (!Number.isInteger(order) || order < 0 || order > 9999) throw new Error('invalid_display_order');
  return order;
}

function parseSponsor(input: any, previous?: any): SponsorInput {
  const merged = { ...(previous ?? {}), ...(input ?? {}) };
  const tier = TIERS.includes(merged.tier) ? (merged.tier as SponsorTier) : null;
  if (!tier) throw new Error('invalid_tier');

  return {
    edition_id: requiredText(merged.edition_id, 100, 'edition_id'),
    name: requiredText(merged.name, 160, 'name'),
    tier,
    logo_url: httpUrl(merged.logo_url, 'logo_url'),
    logo_path: optionalText(merged.logo_path, 400, 'logo_path'),
    website_url: optionalHttpUrl(merged.website_url, 'website_url'),
    display_order: displayOrder(merged.display_order),
  };
}

async function editionExists(sb: SupabaseClient, editionId: string): Promise<boolean | null> {
  const result = await sb.from('editions').select('id').eq('id', editionId).maybeSingle();
  if (result.error) return null;
  return Boolean(result.data);
}

/**
 * Best-effort object cleanup. A row that saved successfully must not fail
 * because its predecessor's artwork lingers in the bucket; an orphaned object
 * costs a few kilobytes and nothing else.
 */
async function removeObject(sb: SupabaseClient, path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await sb.storage.from(SPONSOR_LOGO_BUCKET).remove([path]);
  } catch {
    // ignored on purpose — see above.
  }
}

export async function handleSponsorList(req: Request, sb: SupabaseClient, origin: string): Promise<Response> {
  const editionId = new URL(req.url).searchParams.get('edition_id')?.trim() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);

  const result = await sb
    .from('sponsors')
    .select('*')
    .eq('edition_id', editionId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const rank = (tier: string) => {
    const index = TIERS.indexOf(tier as SponsorTier);
    return index === -1 ? TIERS.length : index;
  };
  const sponsors = ((result.data ?? []) as any[]).slice().sort((a, b) =>
    rank(a.tier) - rank(b.tier)
    || (a.display_order ?? 0) - (b.display_order ?? 0)
    || String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' })
  );
  return adminJson({ sponsors }, 200, origin);
}

export async function handleSponsorGet(sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const result = await sb.from('sponsors').select('*').eq('id', id).maybeSingle();
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!result.data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ sponsor: result.data }, 200, origin);
}

export async function handleSponsorCreate(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  let row: SponsorInput;
  try { row = parseSponsor({ tier: 'partner', display_order: 0, ...body }); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  const exists = await editionExists(sb, row.edition_id);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  const inserted = await sb.from('sponsors').insert(row).select().single();
  if (inserted.error || !inserted.data) return adminJson({ error: 'insert_failed' }, 500, origin);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'sponsor.create',
    target_table: 'sponsors',
    target_id: (inserted.data as any).id,
    diff: inserted.data,
  });
  return adminJson({ ok: true, sponsor: inserted.data }, 200, origin);
}

export async function handleSponsorPatch(
  req: Request,
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('sponsors').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  let row: SponsorInput;
  try { row = parseSponsor(body, before.data); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  const exists = await editionExists(sb, row.edition_id);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  const updated = await sb.from('sponsors').update(row).eq('id', id).select().single();
  if (updated.error || !updated.data) return adminJson({ error: 'update_failed' }, 500, origin);

  // The replaced artwork is unreachable the moment the row stops pointing at
  // it, so drop it rather than leaving it to accumulate.
  const previousPath = (before.data as any).logo_path as string | null;
  if (previousPath && previousPath !== row.logo_path) await removeObject(sb, previousPath);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'sponsor.update',
    target_table: 'sponsors',
    target_id: id,
    diff: diffRows(before.data as any, { ...(before.data as any), ...row }),
  });
  return adminJson({ ok: true, sponsor: updated.data }, 200, origin);
}

export async function handleSponsorDelete(
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const before = await sb.from('sponsors').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const deleted = await sb.from('sponsors').delete().eq('id', id);
  if (deleted.error) return adminJson({ error: 'delete_failed' }, 500, origin);

  await removeObject(sb, (before.data as any).logo_path);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'sponsor.delete',
    target_table: 'sponsors',
    target_id: id,
    diff: before.data,
  });
  return adminJson({ ok: true }, 200, origin);
}

/**
 * POST /api/admin/sponsors/logo?edition_id=…&filename=…
 *
 * The body is the raw image; `Content-Type` names the format. Uploading is
 * deliberately separate from saving the row: the console can show a preview of
 * the real, stored artwork before an admin commits the rest of the form, and a
 * logo swap on an existing sponsor never risks losing the row it belongs to.
 */
export async function handleSponsorLogoUpload(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const editionId = params.get('edition_id')?.trim() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);

  const contentType = (req.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS[contentType];
  if (!extension) return adminJson({ error: 'unsupported_image_type' }, 415, origin);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) return adminJson({ error: 'empty_image' }, 400, origin);
  if (bytes.byteLength > MAX_LOGO_BYTES) return adminJson({ error: 'image_too_large' }, 413, origin);

  const exists = await editionExists(sb, editionId);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  // Random key, not the uploaded filename: a re-upload must not collide with,
  // or silently overwrite, artwork another row still points at.
  const path = `${editionId}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await sb.storage.from(SPONSOR_LOGO_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
    cacheControl: '31536000',
  });
  if (uploaded.error) return adminJson({ error: 'upload_failed' }, 500, origin);

  const { data } = sb.storage.from(SPONSOR_LOGO_BUCKET).getPublicUrl(path);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'sponsor.logo_upload',
    target_table: 'sponsors',
    target_id: null,
    diff: { path, bytes: bytes.byteLength, content_type: contentType },
  });
  return adminJson({ ok: true, logo_url: data.publicUrl, logo_path: path }, 200, origin);
}
