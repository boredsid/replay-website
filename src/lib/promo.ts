// src/lib/promo.ts
// Browser mirror of the Worker's promo rules, so the price summary re-prices
// instantly when the attendee changes pass, day, or quantity after applying a
// code. The Worker re-evaluates on submit and is the authority — this exists
// only so the form does not have to round-trip on every keystroke, the same
// way it already mirrors the Guild Path calculation.
import type { ApiPromoRule, PassType } from './types';

/** What an applied code is worth against the current selection. */
export function promoDiscountFor(args: {
  rule: ApiPromoRule;
  ticketPrice: number;
  quantity: number;
}): number {
  const { rule, ticketPrice, quantity } = args;
  const applicable = rule.scope === 'first_ticket' ? ticketPrice : ticketPrice * quantity;
  if (applicable <= 0) return 0;

  let discount: number;
  if (rule.discount_type === 'percent') {
    discount = Math.round((applicable * rule.discount_value) / 100);
    if (rule.max_discount !== null) discount = Math.min(discount, rule.max_discount);
  } else {
    discount = rule.discount_value;
  }
  return Math.max(0, Math.min(discount, applicable));
}

/** Whether a code still covers the pass the attendee has since switched to. */
export function promoAppliesToPass(rule: ApiPromoRule, passType: PassType): boolean {
  return rule.pass_type === null || rule.pass_type === passType;
}

/**
 * Whether a bulk code still covers the order after the attendee changed how
 * many tickets they are buying. Older Worker responses carry no floor, so a
 * missing value reads as one — the rule every code followed before bulk
 * discounts existed.
 */
export function promoAppliesToQuantity(rule: ApiPromoRule, quantity: number): boolean {
  return quantity >= (rule.min_quantity ?? 1);
}

/**
 * Guild Path and promo codes do not stack: the larger wins, ties going to the
 * Guild Path benefit the attendee already holds.
 */
export function winningDiscount(args: { guildDiscount: number; promoDiscount: number }): {
  amount: number;
  source: 'guild' | 'promo' | null;
} {
  const guild = Math.max(0, args.guildDiscount);
  const promo = Math.max(0, args.promoDiscount);
  if (guild === 0 && promo === 0) return { amount: 0, source: null };
  if (promo > guild) return { amount: promo, source: 'promo' };
  return { amount: guild, source: 'guild' };
}

const PROMO_ERROR_COPY: Record<string, string> = {
  promo_not_found: "That code isn't valid for this edition.",
  promo_inactive: 'That code is no longer active.',
  promo_not_started: "That code isn't active yet.",
  promo_expired: 'That code has expired.',
  promo_pass_type: "That code doesn't apply to the pass you've chosen.",
  promo_min_quantity: 'That code needs a larger booking.',
  promo_exhausted: 'That code has been fully claimed.',
  promo_already_used: "You've already used that code.",
  registration_closed: 'Registration just closed. Please refresh.',
  rate_limited: 'Too many tries. Wait a moment and try again.',
};

/**
 * Copy for a refusal. A minimum-quantity refusal is the one case where the
 * number is the whole answer, so the Worker sends it back and it is spelled out
 * rather than left as "a larger booking".
 */
export function promoErrorMessage(error: unknown, detail?: { min_quantity?: number | null }): string {
  if (error === 'promo_min_quantity' && typeof detail?.min_quantity === 'number') {
    return `That code needs at least ${detail.min_quantity} tickets.`;
  }
  return (typeof error === 'string' && PROMO_ERROR_COPY[error]) || "We couldn't check that code. Please retry.";
}

/** The same sentence, for a code dropped locally rather than refused by the Worker. */
export function promoQuantityMessage(minQuantity: number): string {
  return `That code needs at least ${minQuantity} tickets.`;
}
