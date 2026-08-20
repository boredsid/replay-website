import { describe, expect, it } from 'vitest';
import { readPricing, calculateBasePrice, calculateDiscount } from './pricing';

const PRICING = {
  oneshot: 800,
  campaign: 1400,
  adventurer_cap: 1000,
};

describe('readPricing', () => {
  it('parses a well-formed pricing JSONB', () => {
    expect(readPricing(PRICING)).toEqual(PRICING);
  });
  it('defaults adventurer_cap to Infinity when missing', () => {
    const p = { oneshot: 600, campaign: 999 };
    expect(readPricing(p).adventurer_cap).toBe(Infinity);
  });
  it('parses a single-day edition with no two-day price', () => {
    const p = { oneshot: 800, adventurer_cap: 1000 };
    expect(readPricing(p)).toEqual({ oneshot: 800, campaign: null, adventurer_cap: 1000 });
  });
  it('normalizes the old per-day shape when every day used the same price', () => {
    const p = { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 };
    expect(readPricing(p)).toEqual(PRICING);
  });
  it('throws when oneshot is missing, invalid, or has differing legacy day prices', () => {
    expect(() => readPricing({ campaign: 1 } as any)).toThrow();
    expect(() => readPricing({ oneshot: { day2: 800 } } as any)).toThrow(); // no day1
    expect(() => readPricing({ oneshot: { day1: 'x' } } as any)).toThrow(); // non-number
    expect(() => readPricing({ oneshot: { day1: 800, day2: 900 } } as any)).toThrow();
    expect(() => readPricing(null as any)).toThrow();
  });
});

describe('calculateBasePrice', () => {
  it('campaign always returns campaign price regardless of days', () => {
    expect(calculateBasePrice(PRICING, 'campaign', ['day1', 'day2'])).toBe(1400);
  });
  it('oneshot returns the same price for either requested day', () => {
    expect(calculateBasePrice(PRICING, 'oneshot', ['day1'])).toBe(800);
    expect(calculateBasePrice(PRICING, 'oneshot', ['day2'])).toBe(800);
  });
});

describe('calculateDiscount', () => {
  it('returns 0 for no/null tier', () => {
    expect(calculateDiscount({ base: 800, tier: null, adventurer_cap: 1000 })).toBe(0);
  });
  it('initiate: 20% of base, integer rounded', () => {
    expect(calculateDiscount({ base: 800, tier: 'initiate', adventurer_cap: 1000 })).toBe(160);
    expect(calculateDiscount({ base: 999, tier: 'initiate', adventurer_cap: 1000 })).toBe(200); // 199.8 rounds to 200
  });
  it('adventurer: min(base, cap)', () => {
    expect(calculateDiscount({ base: 800, tier: 'adventurer', adventurer_cap: 1000 })).toBe(800);
    expect(calculateDiscount({ base: 1400, tier: 'adventurer', adventurer_cap: 1000 })).toBe(1000);
    expect(calculateDiscount({ base: 1400, tier: 'adventurer', adventurer_cap: Infinity })).toBe(1400);
  });
  it('guildmaster: full base', () => {
    expect(calculateDiscount({ base: 1400, tier: 'guildmaster', adventurer_cap: 1000 })).toBe(1400);
  });
});
