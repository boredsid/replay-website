import {
  PARTNER_OFFER_LABELS,
  partnerOfferKind,
  type PartnerKind,
  type PartnerOfferKey,
} from './partner-offers';

export type { PartnerKind };

/** The subset of `PartnerOfferKey` whose price lives on the edition. */
export type PartnerPackageKey = 'standard_booth' | 'community_booth' | 'standard_engagement' | 'patron_engagement';

export interface PartnerPricing {
  gst_rate: number;
  standard_booth: number;
  community_booth: number;
  standard_engagement: number;
  patron_engagement: number;
}

export const DEFAULT_PARTNER_PRICING: PartnerPricing = {
  gst_rate: 0.18,
  standard_booth: 8000,
  community_booth: 6500,
  standard_engagement: 3000,
  patron_engagement: 3500,
};

const PACKAGE_KEYS: PartnerPackageKey[] = [
  'standard_booth',
  'community_booth',
  'standard_engagement',
  'patron_engagement',
];

export const PARTNER_PACKAGE_LABELS = Object.fromEntries(
  PACKAGE_KEYS.map((key) => [key, PARTNER_OFFER_LABELS[key]]),
) as Record<PartnerPackageKey, string>;

export function parsePartnerPackage(value: unknown): PartnerPackageKey | null {
  return typeof value === 'string' && PACKAGE_KEYS.includes(value as PartnerPackageKey)
    ? value as PartnerPackageKey
    : null;
}

export function partnerKind(packageKey: PartnerOfferKey): PartnerKind {
  return partnerOfferKind(packageKey);
}

export function readPartnerPricing(input: unknown): PartnerPricing {
  if (input === undefined || input === null) return { ...DEFAULT_PARTNER_PRICING };
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_partner_pricing');
  const value = input as Record<string, unknown>;
  const keys: Array<keyof PartnerPricing> = [
    'gst_rate',
    'standard_booth',
    'community_booth',
    'standard_engagement',
    'patron_engagement',
  ];
  for (const key of keys) {
    const amount = value[key];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error('invalid_partner_pricing');
    }
  }
  if (Number(value.gst_rate) > 1) throw new Error('invalid_partner_pricing');
  return {
    gst_rate: Number(value.gst_rate),
    standard_booth: Number(value.standard_booth),
    community_booth: Number(value.community_booth),
    standard_engagement: Number(value.standard_engagement),
    patron_engagement: Number(value.patron_engagement),
  };
}

export function partnerAmounts(pricing: PartnerPricing, packageKey: PartnerPackageKey) {
  const base = pricing[packageKey];
  const gst = Math.round(base * pricing.gst_rate * 100) / 100;
  return { base, gst, total: base + gst };
}
