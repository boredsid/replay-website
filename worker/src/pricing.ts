// worker/src/pricing.ts
import type { Day, PassType } from './validation';
import type { GuildTier } from './bgc-client';

export interface Pricing {
  oneshot: { day1: number; day2: number };
  campaign: number;
  adventurer_cap: number; // Infinity when uncapped
}

export function readPricing(input: unknown): Pricing {
  if (!input || typeof input !== 'object') {
    throw new Error('pricing: not an object');
  }
  const p = input as any;
  if (
    !p.oneshot ||
    typeof p.oneshot.day1 !== 'number' ||
    typeof p.oneshot.day2 !== 'number'
  ) {
    throw new Error('pricing: oneshot.{day1,day2} required as numbers');
  }
  if (typeof p.campaign !== 'number') {
    throw new Error('pricing: campaign required as number');
  }
  const cap = typeof p.adventurer_cap === 'number' ? p.adventurer_cap : Infinity;
  return {
    oneshot: { day1: p.oneshot.day1, day2: p.oneshot.day2 },
    campaign: p.campaign,
    adventurer_cap: cap,
  };
}

export function calculateBasePrice(pricing: Pricing, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return pricing.campaign;
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
