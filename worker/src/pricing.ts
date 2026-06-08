// worker/src/pricing.ts
import type { Day, PassType } from './validation';
import type { GuildTier } from './bgc-client';

export interface Pricing {
  oneshot: Record<string, number>; // per-day prices keyed day1..dayN (at least day1)
  campaign: number | null;         // null for single-day editions (no multi-day pass)
  adventurer_cap: number;          // Infinity when uncapped
}

export function readPricing(input: unknown): Pricing {
  if (!input || typeof input !== 'object') {
    throw new Error('pricing: not an object');
  }
  const p = input as any;
  if (!p.oneshot || typeof p.oneshot !== 'object') {
    throw new Error('pricing: oneshot required as an object');
  }
  // Editions can be any number of days, so accept a variable day1..dayN map.
  const oneshot: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.oneshot)) {
    if (typeof v !== 'number') throw new Error(`pricing: oneshot.${k} must be a number`);
    oneshot[k] = v;
  }
  if (typeof oneshot.day1 !== 'number') {
    throw new Error('pricing: oneshot.day1 required as a number');
  }
  // campaign (multi-day pass) is optional — single-day editions store null.
  const campaign = typeof p.campaign === 'number' ? p.campaign : null;
  const cap = typeof p.adventurer_cap === 'number' ? p.adventurer_cap : Infinity;
  return { oneshot, campaign, adventurer_cap: cap };
}

export function calculateBasePrice(pricing: Pricing, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return pricing.campaign ?? 0;
  // oneshot: exactly one day, validated upstream
  return pricing.oneshot[days[0]];
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
