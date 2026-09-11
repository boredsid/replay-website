import type { Day, EditionRow, PartnerKind, PartnerOfferKey, PartnerPricing } from './types';

// Mirrors worker/src/partner-offers.ts. The four packages are priced on the
// edition; the sponsorship ladder is negotiated, so the figures below are the
// asks published in docs/reference/SPONSORSHIP.md and are only a starting point an admin
// can type over.

export interface PartnerOffer {
  key: PartnerOfferKey;
  label: string;
  kind: PartnerKind;
  /** Whether the offer covers the whole weekend, or is sold per day (one day or both). */
  days: 'weekend' | 'single';
  /** Set when `editions.partner_pricing` carries the price. */
  pricingKey?: keyof Omit<PartnerPricing, 'gst_rate'>;
  /** Fallback ask for negotiated offers. */
  suggestedAmount?: number;
}

export const PARTNER_OFFERS: PartnerOffer[] = [
  { key: 'standard_booth', label: 'Standard booth', kind: 'booth', days: 'weekend', pricingKey: 'standard_booth' },
  { key: 'community_booth', label: 'Community booth', kind: 'booth', days: 'weekend', pricingKey: 'community_booth' },
  { key: 'standard_engagement', label: 'Standard engagement', kind: 'community_engagement', days: 'single', pricingKey: 'standard_engagement' },
  { key: 'patron_engagement', label: 'Patron engagement', kind: 'community_engagement', days: 'single', pricingKey: 'patron_engagement' },
  { key: 'title_sponsor', label: 'Title sponsor', kind: 'sponsorship', days: 'weekend', suggestedAmount: 100000 },
  { key: 'association_sponsor', label: 'In association with', kind: 'sponsorship', days: 'weekend', suggestedAmount: 25000 },
  { key: 'zone_sponsor', label: 'Zone partner', kind: 'sponsorship', days: 'weekend', suggestedAmount: 15000 },
  { key: 'gaming_sponsor', label: 'Gaming partner', kind: 'sponsorship', days: 'weekend', suggestedAmount: 10000 },
  { key: 'venue_sponsor', label: 'Venue partner', kind: 'sponsorship', days: 'weekend', suggestedAmount: 0 },
];

export const PARTNER_OFFER_LABELS = Object.fromEntries(
  PARTNER_OFFERS.map((offer) => [offer.key, offer.label]),
) as Record<PartnerOfferKey, string>;

export const DEFAULT_PARTNER_PRICING: PartnerPricing = {
  gst_rate: 0.18,
  standard_booth: 8000,
  community_booth: 6500,
  standard_engagement: 3000,
  patron_engagement: 3500,
};

export function partnerOffer(key: PartnerOfferKey): PartnerOffer {
  return PARTNER_OFFERS.find((offer) => offer.key === key) ?? PARTNER_OFFERS[0];
}

export function isSingleDay(key: PartnerOfferKey): boolean {
  return partnerOffer(key).days === 'single';
}

/** Which days a per-day offer runs on. */
export type DayChoice = Day | 'both';

export function choiceDays(choice: DayChoice): Day[] {
  return choice === 'both' ? ['day1', 'day2'] : [choice];
}

export function dayChoiceOf(days: Day[]): DayChoice {
  return days.length === 2 ? 'both' : days[0] ?? 'day1';
}

/**
 * Starting amounts for an offer: the edition's price, or the published ask.
 * Per-day offers are priced per day, so an engagement on both days starts at
 * twice the one-day price.
 */
export function offerAmounts(edition: EditionRow | undefined, key: PartnerOfferKey, choice: DayChoice = 'day1') {
  const pricing = edition?.partner_pricing ?? DEFAULT_PARTNER_PRICING;
  const offer = partnerOffer(key);
  const perDay = offer.pricingKey ? pricing[offer.pricingKey] : offer.suggestedAmount ?? 0;
  const base = offer.days === 'single' && choice === 'both' ? perDay * 2 : perDay;
  return { base, gst: Math.round(base * pricing.gst_rate * 100) / 100 };
}
