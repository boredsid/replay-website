// worker/src/promo.ts
// Pure promo-code rules. No env access, no database — the same judgement runs
// in the preview endpoint, in the public registration, and in an admin's
// manual registration, so it lives in one testable place.
import type { PassType } from './validation';

export type PromoDiscountType = 'percent' | 'flat';
export type PromoScope = 'booking' | 'first_ticket';

export interface PromoCodeRow {
  id: string;
  edition_id: string;
  code: string;
  applied_message: string;
  discount_type: PromoDiscountType;
  discount_value: number;
  max_discount: number | null;
  scope: PromoScope;
  /** Null when the code works on either pass. */
  pass_type: PassType | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  max_per_phone: number;
  /** Tickets a booking must carry before the code applies. 1 means no floor. */
  min_quantity: number;
  is_active: boolean;
}

/** Why a code was refused. These strings reach the browser verbatim. */
export type PromoRejection =
  | 'promo_not_found'
  | 'promo_inactive'
  | 'promo_not_started'
  | 'promo_expired'
  | 'promo_pass_type'
  | 'promo_min_quantity'
  | 'promo_exhausted'
  | 'promo_already_used';

export interface PromoRedemptions {
  /** Uncancelled registrations already holding this code, across everyone. */
  total: number;
  /** Uncancelled registrations already holding this code for this phone. */
  forPhone: number;
}

export interface PromoAcceptance {
  ok: true;
  id: string;
  code: string;
  message: string;
  discount: number;
}

export interface PromoRefusal {
  ok: false;
  reason: PromoRejection;
}

export type PromoResult = PromoAcceptance | PromoRefusal;

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/**
 * Canonical form of an attendee-typed code: trimmed and uppercased. Returns ''
 * when the input could not be a code at all, which callers treat as "no code
 * supplied" rather than as a rejection.
 */
export function normalizePromoCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  const code = input.trim().toUpperCase();
  return CODE_RE.test(code) ? code : '';
}

/**
 * What the code is worth against this booking, before it is weighed against
 * any Guild Path benefit. A `first_ticket` code discounts one ticket the way
 * the Guild Path benefit does; a `booking` code discounts the whole order.
 * The result never exceeds the amount it applies to, so a booking can never
 * price below zero.
 */
export function calculatePromoDiscount(args: {
  promo: Pick<PromoCodeRow, 'discount_type' | 'discount_value' | 'max_discount' | 'scope'>;
  ticketPrice: number;
  quantity: number;
}): number {
  const { promo, ticketPrice, quantity } = args;
  const applicable = promo.scope === 'first_ticket' ? ticketPrice : ticketPrice * quantity;
  if (applicable <= 0) return 0;

  let discount: number;
  if (promo.discount_type === 'percent') {
    discount = Math.round((applicable * promo.discount_value) / 100);
    if (promo.max_discount !== null) discount = Math.min(discount, promo.max_discount);
  } else {
    discount = promo.discount_value;
  }
  return Math.max(0, Math.min(discount, applicable));
}

/**
 * Full acceptance check. `redemptions` counts uncancelled registrations that
 * already hold this code, so a cancellation returns a redemption to the pool.
 */
export function evaluatePromo(args: {
  promo: PromoCodeRow | null;
  ticketPrice: number;
  quantity: number;
  passType: PassType;
  redemptions: PromoRedemptions;
  now?: Date;
}): PromoResult {
  const { promo, ticketPrice, quantity, passType, redemptions } = args;
  const now = args.now ?? new Date();

  if (!promo) return { ok: false, reason: 'promo_not_found' };
  if (!promo.is_active) return { ok: false, reason: 'promo_inactive' };
  if (promo.starts_at && new Date(promo.starts_at) > now) return { ok: false, reason: 'promo_not_started' };
  if (promo.ends_at && new Date(promo.ends_at) <= now) return { ok: false, reason: 'promo_expired' };
  if (promo.pass_type && promo.pass_type !== passType) return { ok: false, reason: 'promo_pass_type' };
  // A bulk code is refused outright rather than applied at zero: an attendee
  // who is one ticket short should be told the floor, not shown a code that
  // silently saves nothing.
  if (quantity < promo.min_quantity) return { ok: false, reason: 'promo_min_quantity' };
  if (promo.max_redemptions !== null && redemptions.total >= promo.max_redemptions) {
    return { ok: false, reason: 'promo_exhausted' };
  }
  if (redemptions.forPhone >= promo.max_per_phone) {
    return { ok: false, reason: 'promo_already_used' };
  }

  return {
    ok: true,
    id: promo.id,
    code: promo.code,
    message: promo.applied_message,
    discount: calculatePromoDiscount({ promo, ticketPrice, quantity }),
  };
}

export type DiscountSource = 'guild' | 'promo' | null;

export interface ResolvedDiscount {
  /** What the attendee actually saves. */
  amount: number;
  source: DiscountSource;
  /** The promo's contribution, so zero whenever the Guild Path benefit won. */
  promoDiscount: number;
  /** The tier to record, so null whenever the promo won. */
  guildApplied: boolean;
}

/**
 * Guild Path and promo codes do not stack: the larger of the two applies and
 * the other is dropped. A tie goes to the Guild Path benefit, which the
 * attendee already holds and did not have to type in.
 */
export function resolveDiscount(args: { guildDiscount: number; promoDiscount: number }): ResolvedDiscount {
  const guild = Math.max(0, args.guildDiscount);
  const promo = Math.max(0, args.promoDiscount);
  if (guild === 0 && promo === 0) {
    return { amount: 0, source: null, promoDiscount: 0, guildApplied: false };
  }
  if (promo > guild) {
    return { amount: promo, source: 'promo', promoDiscount: promo, guildApplied: false };
  }
  return { amount: guild, source: 'guild', promoDiscount: 0, guildApplied: true };
}
