export type PartnerKind = 'booth' | 'community_engagement';
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

export const PARTNER_PACKAGE_LABELS: Record<PartnerPackageKey, string> = {
  standard_booth: 'Standard booth',
  community_booth: 'Community booth',
  standard_engagement: 'Standard engagement',
  patron_engagement: 'Patron engagement',
};

const PACKAGE_KEYS = Object.keys(PARTNER_PACKAGE_LABELS) as PartnerPackageKey[];

export function parsePartnerPackage(value: unknown): PartnerPackageKey | null {
  return typeof value === 'string' && PACKAGE_KEYS.includes(value as PartnerPackageKey)
    ? value as PartnerPackageKey
    : null;
}

export function partnerKind(packageKey: PartnerPackageKey): PartnerKind {
  return packageKey === 'standard_booth' || packageKey === 'community_booth'
    ? 'booth'
    : 'community_engagement';
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
