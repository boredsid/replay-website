import type { EditionRow, PartnerKind, PartnerOfferKey, PartnerPricing } from './types';

// Mirrors worker/src/partner-offers.ts. The four packages are priced on the
// edition; the sponsorship ladder is negotiated, so the figures below are the
// asks published in docs/SPONSORSHIP.md and are only a starting point an admin
// can type over.

export interface PartnerOffer {
  key: PartnerOfferKey;
  label: string;
  kind: PartnerKind;
  /** Whether the offer covers the whole weekend or a single day. */
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

/** Starting amounts for an offer: the edition's price, or the published ask. */
export function offerAmounts(edition: EditionRow | undefined, key: PartnerOfferKey) {
  const pricing = edition?.partner_pricing ?? DEFAULT_PARTNER_PRICING;
  const offer = partnerOffer(key);
  const base = offer.pricingKey ? pricing[offer.pricingKey] : offer.suggestedAmount ?? 0;
  return { base, gst: Math.round(base * pricing.gst_rate * 100) / 100 };
}
