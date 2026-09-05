import type { GuildTier } from './types';

/**
 * Why a registration cost what it cost.
 *
 * A row attributes its discount to at most one source. The Worker records
 * `guild_tier_at_purchase` only when the Guild Path benefit beat the promo
 * code, and the promo columns only when the code won, so the cases below are
 * genuinely exclusive — and a code that lost leaves no trace on the row at all.
 *
 * The last two cases are the honest answer when a row carries money off that
 * nobody attributed: an imported REPLAY 2 registration, where the discount was
 * derived as `base - paid` with no tier recorded, or an amount an organiser
 * typed down by hand. Guessing "guild" or "promo" for those would misreport
 * them, so they get their own names.
 */
export interface DiscountFacts {
  amount_paid: number;
  discount_applied?: number | null;
  guild_tier_at_purchase?: GuildTier | null;
  promo_code?: string | null;
  promo_discount?: number | null;
  /** UTM data for a public sign-up; `{ manual, by }` for a desk entry. */
  source?: Record<string, unknown> | null;
}

export type DiscountKind = 'guild' | 'promo' | 'adjusted' | 'desk' | 'none';

export const TIER_NAMES: Record<GuildTier, string> = {
  initiate: 'Initiate',
  adventurer: 'Adventurer',
  guildmaster: 'Guildmaster',
};

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN');

/** True when this row was typed in at the desk rather than bought on the site. */
function isManual(source: DiscountFacts['source']): boolean {
  return !!source && source.manual === true;
}

/**
 * The one word that explains this row's amount.
 *
 * Guild and promo outrank a desk entry because they say more: a walk-up who
 * redeemed a code is better described by the code than by the till it went
 * through. `desk` is what is left for a hand-entered row with nothing else on
 * it, which is the usual reason a registration reads ₹0 for no visible cause.
 */
export function discountKind(reg: DiscountFacts): DiscountKind {
  if (reg.guild_tier_at_purchase) return 'guild';
  if (reg.promo_code || Number(reg.promo_discount ?? 0) > 0) return 'promo';
  if (Number(reg.discount_applied ?? 0) > 0) return 'adjusted';
  if (isManual(reg.source)) return 'desk';
  return 'none';
}

/** Compact tag for a list row. Null when there is nothing worth marking. */
export function discountMarker(reg: DiscountFacts): string | null {
  const kind = discountKind(reg);
  if (kind === 'none') return null;
  return { guild: 'Guild', promo: 'Promo', adjusted: 'Adjusted', desk: 'Desk' }[kind];
}

/** The full explanation, for the drawer. */
export function describeDiscount(reg: DiscountFacts): { label: string; detail: string | null } {
  const discount = Number(reg.discount_applied ?? 0);
  const promoDiscount = Number(reg.promo_discount ?? 0);
  const free = Number(reg.amount_paid) === 0;
  const covered = free ? ', which covered the pass in full' : '';

  switch (discountKind(reg)) {
    case 'guild': {
      const tier = reg.guild_tier_at_purchase as GuildTier;
      const name = TIER_NAMES[tier] ?? tier;
      return {
        label: `Guild Path — ${name}`,
        detail: discount > 0
          ? `${inr(discount)} off at the ${name} tier${covered}.`
          : 'Recorded as a member benefit, though nothing came off the price.',
      };
    }
    case 'promo':
      return {
        label: `Promo code — ${reg.promo_code || 'code not recorded'}`,
        detail: `${inr(promoDiscount || discount)} off${covered}. No Guild Path benefit applied.`,
      };
    case 'adjusted':
      return {
        label: 'Not attributed',
        detail: `${inr(discount)} off with no Guild Path tier or promo code against it — an imported row, or an amount set by hand.`,
      };
    case 'desk':
      return {
        label: 'None recorded',
        detail: free
          ? 'Nothing was paid, and no discount was attributed — this row was entered by hand.'
          : 'No discount was attributed. This row was entered by hand.',
      };
    default:
      return {
        label: free ? 'None recorded' : 'None — full price',
        detail: free ? 'Nothing was paid, but no discount was attributed either — a comp, or a free edition.' : null,
      };
  }
}

/** Who put this row in, when that is knowable from `source`. */
export function describeEntry(source: DiscountFacts['source']): string | null {
  if (!isManual(source)) return null;
  const by = typeof source?.by === 'string' ? source.by : null;
  return by ? `By hand at the desk — ${by}` : 'By hand at the desk';
}
