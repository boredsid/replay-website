import { describe, expect, it } from 'vitest';
import { partnerAmounts, partnerKind, readPartnerPricing } from './partner-pricing';

describe('partner pricing', () => {
  it('calculates the approved GST-inclusive totals', () => {
    const pricing = readPartnerPricing(undefined);
    expect(partnerAmounts(pricing, 'standard_booth')).toEqual({ base: 8000, gst: 1440, total: 9440 });
    expect(partnerAmounts(pricing, 'patron_engagement')).toEqual({ base: 3500, gst: 630, total: 4130 });
  });

  it('derives the operational kind from the package', () => {
    expect(partnerKind('community_booth')).toBe('booth');
    expect(partnerKind('standard_engagement')).toBe('community_engagement');
  });
});
