// worker/src/pricing.ts
import type { Day, PassType } from './validation';
import type { GuildTier } from './bgc-client';

export interface Pricing {
  oneshot: number;                 // one price for any single-day pass
  campaign: number | null;         // null for single-day editions (no multi-day pass)
  adventurer_cap: number;          // Infinity when uncapped
}

export function readPricing(input: unknown): Pricing {
  if (!input || typeof input !== 'object') {
    throw new Error('pricing: not an object');
  }
  const p = input as any;
  let oneshot: number;
  if (typeof p.oneshot === 'number') {
    oneshot = p.oneshot;
  } else if (p.oneshot && typeof p.oneshot === 'object' && !Array.isArray(p.oneshot)) {
    // Rolling-deploy compatibility for the old {day1, day2} database shape.
    const legacyPrices = Object.values(p.oneshot);
    if (typeof p.oneshot.day1 !== 'number' || legacyPrices.some((value) => value !== p.oneshot.day1)) {
      throw new Error('pricing: legacy day prices must be identical numbers');
    }
    oneshot = p.oneshot.day1;
  } else {
    throw new Error('pricing: oneshot required as a number');
  }
  // campaign (multi-day pass) is optional — single-day editions store null.
  const campaign = typeof p.campaign === 'number' ? p.campaign : null;
  const cap = typeof p.adventurer_cap === 'number' ? p.adventurer_cap : Infinity;
  return { oneshot, campaign, adventurer_cap: cap };
}

export function calculateBasePrice(pricing: Pricing, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return pricing.campaign ?? 0;
  // oneshot: exactly one day, validated upstream
  return pricing.oneshot;
}

export function calculateDiscount(args: {
  base: number;
  tier: GuildTier | null;
  adventurer_cap: number;
}): number {
  const { base, tier, adventurer_cap } = args;
  if (tier === null) return 0;
  if (tier === 'initiate') return Math.round(base * 0.2);
  if (tier === 'adventurer') return Math.min(base, adventurer_cap);
  if (tier === 'guildmaster') return base;
  return 0;
}
