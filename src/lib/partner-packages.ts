import type { PartnerPackageKey, PartnerPricing } from './types';

export const DEFAULT_PARTNER_PRICING: PartnerPricing = {
  gst_rate: 0.18,
  standard_booth: 8000,
  community_booth: 6500,
  standard_engagement: 3000,
  patron_engagement: 3500,
};

export const PARTNER_PACKAGE_LABELS: Record<PartnerPackageKey, string> = {
  standard_booth: 'Standard booth',
  community_booth: 'Community booth',
  standard_engagement: 'Standard engagement',
  patron_engagement: 'Patron engagement',
};

export function readPartnerPricing(input: unknown): PartnerPricing {
  if (input === undefined || input === null) return { ...DEFAULT_PARTNER_PRICING };
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('partner pricing is not an object');
  const value = input as Record<string, unknown>;
  const keys: Array<keyof PartnerPricing> = [
    'gst_rate',
    'standard_booth',
    'community_booth',
    'standard_engagement',
    'patron_engagement',
  ];
  for (const key of keys) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Number(value[key]) < 0) {
      throw new Error(`partner pricing ${key} is invalid`);
    }
  }
  if (Number(value.gst_rate) > 1) throw new Error('partner pricing gst_rate is invalid');
  return {
    gst_rate: Number(value.gst_rate),
    standard_booth: Number(value.standard_booth),
    community_booth: Number(value.community_booth),
    standard_engagement: Number(value.standard_engagement),
    patron_engagement: Number(value.patron_engagement),
  };
}

export function partnerBasePrice(pricing: PartnerPricing, packageKey: PartnerPackageKey): number {
  return pricing[packageKey];
}

export function partnerGstAmount(base: number, gstRate: number): number {
  return Math.round(base * gstRate * 100) / 100;
}
