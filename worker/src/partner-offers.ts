// Everything REPLAY sells to a partner, in one place.
//
// Four of these are self-serve packages with a price on the edition
// (`editions.partner_pricing`, see partner-pricing.ts). The five sponsorship
// tiers are negotiated, so an admin-issued invite always carries its own
// amounts. Both kinds share this catalogue so a partner row's `kind`,
// `package_key` and `days` can never disagree with each other.

export type PartnerKind = 'booth' | 'community_engagement' | 'sponsorship';

export type PartnerOfferKey =
  | 'standard_booth'
  | 'community_booth'
  | 'standard_engagement'
  | 'patron_engagement'
  | 'title_sponsor'
  | 'association_sponsor'
  | 'zone_sponsor'
  | 'gaming_sponsor'
  | 'venue_sponsor';

/** How many event days the offer covers. Booths and sponsorships run the whole weekend. */
export type PartnerOfferDays = 'weekend' | 'single';

export interface PartnerOffer {
  key: PartnerOfferKey;
  label: string;
  kind: PartnerKind;
  days: PartnerOfferDays;
  /** True when `editions.partner_pricing` carries the price for this offer. */
  priced: boolean;
}

export const PARTNER_OFFERS: Record<PartnerOfferKey, PartnerOffer> = {
  standard_booth: { key: 'standard_booth', label: 'Standard booth', kind: 'booth', days: 'weekend', priced: true },
  community_booth: { key: 'community_booth', label: 'Community booth', kind: 'booth', days: 'weekend', priced: true },
  standard_engagement: { key: 'standard_engagement', label: 'Standard engagement', kind: 'community_engagement', days: 'single', priced: true },
  patron_engagement: { key: 'patron_engagement', label: 'Patron engagement', kind: 'community_engagement', days: 'single', priced: true },
  title_sponsor: { key: 'title_sponsor', label: 'Title sponsor', kind: 'sponsorship', days: 'weekend', priced: false },
  association_sponsor: { key: 'association_sponsor', label: 'In association with', kind: 'sponsorship', days: 'weekend', priced: false },
  zone_sponsor: { key: 'zone_sponsor', label: 'Zone partner', kind: 'sponsorship', days: 'weekend', priced: false },
  gaming_sponsor: { key: 'gaming_sponsor', label: 'Gaming partner', kind: 'sponsorship', days: 'weekend', priced: false },
  venue_sponsor: { key: 'venue_sponsor', label: 'Venue partner', kind: 'sponsorship', days: 'weekend', priced: false },
};

export const PARTNER_OFFER_KEYS = Object.keys(PARTNER_OFFERS) as PartnerOfferKey[];

export const PARTNER_OFFER_LABELS = Object.fromEntries(
  PARTNER_OFFER_KEYS.map((key) => [key, PARTNER_OFFERS[key].label]),
) as Record<PartnerOfferKey, string>;

export function parsePartnerOffer(value: unknown): PartnerOfferKey | null {
  return typeof value === 'string' && PARTNER_OFFER_KEYS.includes(value as PartnerOfferKey)
    ? value as PartnerOfferKey
    : null;
}

export function partnerOfferKind(key: PartnerOfferKey): PartnerKind {
  return PARTNER_OFFERS[key].kind;
}

export function partnerOfferDays(key: PartnerOfferKey): PartnerOfferDays {
  return PARTNER_OFFERS[key].days;
}

/** Days the offer implies, when they are not the partner's to choose. */
export function defaultOfferDays(key: PartnerOfferKey): Array<'day1' | 'day2'> {
  return PARTNER_OFFERS[key].days === 'weekend' ? ['day1', 'day2'] : [];
}

export function validOfferDays(key: PartnerOfferKey, days: Array<'day1' | 'day2'>): boolean {
  if (PARTNER_OFFERS[key].days === 'weekend') {
    return days.length === 2 && days.includes('day1') && days.includes('day2');
  }
  return days.length === 1;
}
