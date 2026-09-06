import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { diffRows, writeAudit } from './audit';
import { normalizePromoCode, evaluatePromo } from '../promo';
import { PROMO_COLUMNS, countPromoRedemptions, loadPromoContext } from '../promo-lookup';

const DISCOUNT_TYPES = ['percent', 'flat'] as const;
const SCOPES = ['booking', 'first_ticket'] as const;
const PASS_TYPES = ['oneshot', 'campaign'] as const;

type PromoInput = {
  edition_id: string;
  code: string;
  applied_message: string;
  internal_note: string | null;
  discount_type: typeof DISCOUNT_TYPES[number];
  discount_value: number;
  max_discount: number | null;
  scope: typeof SCOPES[number];
  pass_type: typeof PASS_TYPES[number] | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  max_per_phone: number;
  min_quantity: number;
  is_active: boolean;
};

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function timestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid_${field}`);
  return parsed.toISOString();
}

function positiveInt(value: unknown, field: string, optional: boolean): number | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`invalid_${field}`);
  return parsed;
}

function parsePromo(input: any, previous?: any): PromoInput {
  const merged = { ...(previous ?? {}), ...(input ?? {}) };

  const code = normalizePromoCode(merged.code);
  if (!code) throw new Error('invalid_code');

  const discountType = DISCOUNT_TYPES.includes(merged.discount_type) ? merged.discount_type : null;
  if (!discountType) throw new Error('invalid_discount_type');
  const scope = SCOPES.includes(merged.scope) ? merged.scope : null;
  if (!scope) throw new Error('invalid_scope');

  const passType = merged.pass_type === null || merged.pass_type === undefined || merged.pass_type === ''
    ? null
    : PASS_TYPES.includes(merged.pass_type) ? merged.pass_type : null;
  if (merged.pass_type && passType === null) throw new Error('invalid_pass_type');

  const discountValue = Number(merged.discount_value);
  if (!Number.isFinite(discountValue) || discountValue <= 0) throw new Error('invalid_discount_value');
  if (discountType === 'percent' && discountValue > 100) throw new Error('invalid_discount_value');

  // A flat code is already its own ceiling, so a cap on one is a contradiction
  // rather than a harmless extra — the database rejects it too.
  let maxDiscount: number | null = null;
  if (merged.max_discount !== null && merged.max_discount !== undefined && merged.max_discount !== '') {
    if (discountType === 'flat') throw new Error('invalid_max_discount');
    const parsed = Number(merged.max_discount);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('invalid_max_discount');
    maxDiscount = parsed;
  }

  const startsAt = timestamp(merged.starts_at, 'starts_at');
  const endsAt = timestamp(merged.ends_at, 'ends_at');
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('invalid_validity_window');

  if (typeof merged.is_active !== 'boolean') throw new Error('invalid_is_active');

  return {
    edition_id: requiredText(merged.edition_id, 100, 'edition_id'),
    code,
    applied_message: requiredText(merged.applied_message, 300, 'applied_message'),
    internal_note: optionalText(merged.internal_note, 500, 'internal_note'),
    discount_type: discountType,
    discount_value: discountValue,
    max_discount: maxDiscount,
    scope,
    pass_type: passType,
    starts_at: startsAt,
    ends_at: endsAt,
    max_redemptions: positiveInt(merged.max_redemptions, 'max_redemptions', true),
    max_per_phone: positiveInt(merged.max_per_phone, 'max_per_phone', false) as number,
    min_quantity: positiveInt(merged.min_quantity, 'min_quantity', false) as number,
    is_active: merged.is_active,
  };
}

async function editionExists(sb: SupabaseClient, editionId: string): Promise<boolean | null> {
  const result = await sb.from('editions').select('id').eq('id', editionId).maybeSingle();
  if (result.error) return null;
  return Boolean(result.data);
}

/** Redemption counts for a page of codes, in one query rather than N. */
async function redemptionCounts(sb: SupabaseClient, promoIds: string[]): Promise<Record<string, number> | null> {
  if (promoIds.length === 0) return {};
  const result = await sb
    .from('registrations')
    .select('promo_code_id')
    .in('promo_code_id', promoIds)
    .neq('payment_status', 'cancelled');
  if (result.error) return null;
  const counts: Record<string, number> = {};
  for (const row of (result.data ?? []) as Array<{ promo_code_id: string }>) {
    counts[row.promo_code_id] = (counts[row.promo_code_id] ?? 0) + 1;
  }
  return counts;
}

export async function handlePromoList(req: Request, sb: SupabaseClient, origin: string): Promise<Response> {
  const editionId = new URL(req.url).searchParams.get('edition_id')?.trim() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);

  const result = await sb
    .from('promo_codes')
    .select(PROMO_COLUMNS)
    .eq('edition_id', editionId)
    .order('created_at', { ascending: false });
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const rows = (result.data ?? []) as Array<{ id: string }>;
  const counts = await redemptionCounts(sb, rows.map((row) => row.id));
  if (!counts) return adminJson({ error: 'query_failed' }, 500, origin);

  return adminJson({
    promo_codes: rows.map((row) => ({ ...row, redemption_count: counts[row.id] ?? 0 })),
  }, 200, origin);
}

export async function handlePromoGet(sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const result = await sb.from('promo_codes').select(PROMO_COLUMNS).eq('id', id).maybeSingle();
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!result.data) return adminJson({ error: 'not_found' }, 404, origin);

  const redemptions = await countPromoRedemptions(sb, id, null);
  if (!redemptions) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ promo_code: { ...result.data, redemption_count: redemptions.total } }, 200, origin);
}

export async function handlePromoCreate(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  let row: PromoInput;
  try {
    row = parsePromo({
      discount_type: 'percent',
      scope: 'booking',
      pass_type: null,
      max_discount: null,
      starts_at: null,
      ends_at: null,
      max_redemptions: null,
      max_per_phone: 1,
      min_quantity: 1,
      is_active: true,
      ...body,
    });
  } catch (error: any) {
    return adminJson({ error: error.message }, 400, origin);
  }

  const exists = await editionExists(sb, row.edition_id);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  const inserted = await sb.from('promo_codes').insert(row).select(PROMO_COLUMNS).single();
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') return adminJson({ error: 'promo_code_exists' }, 409, origin);
    return adminJson({ error: 'insert_failed' }, 500, origin);
  }
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'promo_code.create',
    target_table: 'promo_codes',
    target_id: (inserted.data as any).id,
    diff: inserted.data,
  });
  return adminJson({ ok: true, promo_code: { ...inserted.data, redemption_count: 0 } }, 200, origin);
}

export async function handlePromoPatch(
  req: Request,
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('promo_codes').select(PROMO_COLUMNS).eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  let row: PromoInput;
  try { row = parsePromo(body, before.data); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  const exists = await editionExists(sb, row.edition_id);
  if (exists === null) return adminJson({ error: 'edition_query_failed' }, 500, origin);
  if (!exists) return adminJson({ error: 'edition_not_found' }, 404, origin);

  const updated = await sb.from('promo_codes').update(row).eq('id', id).select(PROMO_COLUMNS).single();
  if (updated.error || !updated.data) {
    if (updated.error?.code === '23505') return adminJson({ error: 'promo_code_exists' }, 409, origin);
    return adminJson({ error: 'update_failed' }, 500, origin);
  }

  const redemptions = await countPromoRedemptions(sb, id, null);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'promo_code.update',
    target_table: 'promo_codes',
    target_id: id,
    diff: diffRows(before.data as any, { ...(before.data as any), ...row }),
  });
  return adminJson({
    ok: true,
    promo_code: { ...updated.data, redemption_count: redemptions?.total ?? 0 },
  }, 200, origin);
}

export async function handlePromoDelete(
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const before = await sb.from('promo_codes').select(PROMO_COLUMNS).eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  // A redeemed code is part of the sales record. Deactivating stops it being
  // used again without rewriting what already happened.
  const redemptions = await countPromoRedemptions(sb, id, null);
  if (!redemptions) return adminJson({ error: 'query_failed' }, 500, origin);
  if (redemptions.total > 0) {
    return adminJson({ error: 'promo_code_redeemed', redemption_count: redemptions.total }, 409, origin);
  }

  const deleted = await sb.from('promo_codes').delete().eq('id', id);
  if (deleted.error) return adminJson({ error: 'delete_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'promo_code.delete',
    target_table: 'promo_codes',
    target_id: id,
    diff: before.data,
  });
  return adminJson({ ok: true }, 200, origin);
}

/**
 * What a code is worth for a manual registration, so the admin drawer can show
 * the discount and pre-fill the amount before anything is saved.
 */
export async function handlePromoValidate(req: Request, sb: SupabaseClient, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const passType = PASS_TYPES.includes(body.pass_type) ? body.pass_type : null;
  const quantity = Number(body.quantity ?? 1);
  const ticketPrice = Number(body.ticket_price);
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').slice(-10) : '';

  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);
  if (!passType) return adminJson({ error: 'invalid_pass_type' }, 400, origin);
  if (!Number.isInteger(quantity) || quantity < 1) return adminJson({ error: 'invalid_quantity' }, 400, origin);
  if (!Number.isFinite(ticketPrice) || ticketPrice < 0) return adminJson({ error: 'invalid_ticket_price' }, 400, origin);

  const code = normalizePromoCode(body.code);
  if (!code) return adminJson({ error: 'promo_not_found' }, 404, origin);

  const context = await loadPromoContext(sb, editionId, code, phone.length === 10 ? phone : null);
  if (!context) return adminJson({ error: 'query_failed' }, 500, origin);

  const result = evaluatePromo({
    promo: context.promo,
    ticketPrice,
    quantity,
    passType,
    redemptions: context.redemptions,
  });
  if (!result.ok) {
    return adminJson(
      { error: result.reason, min_quantity: context.promo?.min_quantity ?? null },
      404,
      origin,
    );
  }

  return adminJson({
    promo: { id: result.id, code: result.code, message: result.message, discount: result.discount },
  }, 200, origin);
}
