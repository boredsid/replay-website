// worker/src/promo-lookup.ts
// The database half of promo handling: find a code for an edition and count
// what it has already been redeemed for. The rules themselves live in
// `promo.ts` so they stay pure and testable.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PromoCodeRow, PromoRedemptions } from './promo';

export const PROMO_COLUMNS =
  'id, edition_id, code, applied_message, internal_note, discount_type, discount_value, max_discount, scope, pass_type, starts_at, ends_at, max_redemptions, max_per_phone, is_active, created_at, updated_at';

export interface PromoContext {
  promo: PromoCodeRow | null;
  redemptions: PromoRedemptions;
}

function readPromoRow(row: any): PromoCodeRow {
  return {
    ...row,
    discount_value: Number(row.discount_value),
    max_discount: row.max_discount === null ? null : Number(row.max_discount),
    max_per_phone: Number(row.max_per_phone),
    max_redemptions: row.max_redemptions === null ? null : Number(row.max_redemptions),
  };
}

/**
 * Count the uncancelled registrations already holding a code. Cancelling a
 * registration returns its redemption to the pool, which is the same rule
 * capacity follows.
 */
export async function countPromoRedemptions(
  sb: SupabaseClient,
  promoId: string,
  phone: string | null,
): Promise<PromoRedemptions | null> {
  const result = await sb
    .from('registrations')
    .select('user_phone')
    .eq('promo_code_id', promoId)
    .neq('payment_status', 'cancelled');
  if (result.error) return null;
  const rows = (result.data ?? []) as Array<{ user_phone: string }>;
  return {
    total: rows.length,
    forPhone: phone ? rows.filter((row) => row.user_phone === phone).length : 0,
  };
}

/**
 * Load a code and its redemption counts in one step. A missing code returns a
 * context with `promo: null` rather than an error, so callers can hand it
 * straight to `evaluatePromo` and get a `promo_not_found` refusal.
 *
 * Returns null only when the database itself failed.
 */
export async function loadPromoContext(
  sb: SupabaseClient,
  editionId: string,
  code: string,
  phone: string | null,
): Promise<PromoContext | null> {
  const result = await sb
    .from('promo_codes')
    .select(PROMO_COLUMNS)
    .eq('edition_id', editionId)
    .eq('code', code)
    .maybeSingle();
  if (result.error) return null;
  if (!result.data) return { promo: null, redemptions: { total: 0, forPhone: 0 } };

  const promo = readPromoRow(result.data);
  const redemptions = await countPromoRedemptions(sb, promo.id, phone);
  if (!redemptions) return null;
  return { promo, redemptions };
}
