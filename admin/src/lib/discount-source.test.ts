import { it, expect } from 'vitest';
import { discountKind, discountMarker, describeDiscount, describeEntry } from './discount-source';

const BASE = { amount_paid: 800, discount_applied: 0 };

it('attributes a pass to the Guild Path tier that paid for it', () => {
  const reg = { ...BASE, amount_paid: 0, discount_applied: 1600, guild_tier_at_purchase: 'guildmaster' as const };
  expect(discountKind(reg)).toBe('guild');
  expect(discountMarker(reg)).toBe('Guild');
  expect(describeDiscount(reg)).toEqual({
    label: 'Guild Path — Guildmaster',
    detail: '₹1,600 off at the Guildmaster tier, which covered the pass in full.',
  });
});

it('attributes a pass to the promo code when no tier was recorded', () => {
  const reg = { ...BASE, amount_paid: 400, discount_applied: 400, promo_code: 'EARLYBIRD', promo_discount: 400 };
  expect(discountMarker(reg)).toBe('Promo');
  expect(describeDiscount(reg).label).toBe('Promo code — EARLYBIRD');
});

it('prefers the discount source over the till a desk entry went through', () => {
  const reg = { ...BASE, promo_code: 'DOOR10', promo_discount: 100, source: { manual: true, by: 'desk@x.in' } };
  expect(discountKind(reg)).toBe('promo');
});

it('refuses to guess a source for an unattributed discount', () => {
  const reg = { ...BASE, amount_paid: 600, discount_applied: 1000 };
  expect(discountMarker(reg)).toBe('Adjusted');
  expect(describeDiscount(reg).label).toBe('Not attributed');
});

it('names a hand-entered row, which is why most ₹0 rows are ₹0', () => {
  const reg = { ...BASE, amount_paid: 0, source: { manual: true, by: 'desk@x.in' } };
  expect(discountMarker(reg)).toBe('Desk');
  expect(describeDiscount(reg).label).toBe('None recorded');
  expect(describeEntry(reg.source)).toBe('By hand at the desk — desk@x.in');
});

it('leaves a full-price pass unmarked', () => {
  expect(discountMarker(BASE)).toBeNull();
  expect(describeDiscount(BASE)).toEqual({ label: 'None — full price', detail: null });
  expect(describeEntry(null)).toBeNull();
});

it('flags a free pass that nothing on the row explains', () => {
  const reg = { ...BASE, amount_paid: 0 };
  expect(discountMarker(reg)).toBeNull();
  expect(describeDiscount(reg).detail).toMatch(/a comp, or a free edition/);
});

it('reads numeric columns that arrive as strings', () => {
  const reg = { amount_paid: '0' as any, discount_applied: '1600' as any, guild_tier_at_purchase: 'adventurer' as const };
  expect(describeDiscount(reg).detail).toBe('₹1,600 off at the Adventurer tier, which covered the pass in full.');
});
