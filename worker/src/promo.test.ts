import { describe, expect, it } from 'vitest';
import {
  normalizePromoCode,
  calculatePromoDiscount,
  evaluatePromo,
  resolveDiscount,
  type PromoCodeRow,
} from './promo';

const NOW = new Date('2026-09-15T10:00:00Z');

function promo(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: 'promo-1',
    edition_id: 'edition-1',
    code: 'SAVE20',
    applied_message: 'Nice — 20% off your order.',
    discount_type: 'percent',
    discount_value: 20,
    max_discount: null,
    scope: 'booking',
    pass_type: null,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    max_per_phone: 1,
    min_quantity: 1,
    is_active: true,
    ...overrides,
  };
}

const NO_REDEMPTIONS = { total: 0, forPhone: 0 };

describe('normalizePromoCode', () => {
  it('trims and uppercases what the attendee typed', () => {
    expect(normalizePromoCode('  save20 ')).toBe('SAVE20');
    expect(normalizePromoCode('early-bird')).toBe('EARLY-BIRD');
    expect(normalizePromoCode('BGC_2026')).toBe('BGC_2026');
  });
  it('returns empty for anything that could not be a code', () => {
    expect(normalizePromoCode('')).toBe('');
    expect(normalizePromoCode('a')).toBe(''); // under two characters
    expect(normalizePromoCode('-LEADING')).toBe(''); // must start alphanumeric
    expect(normalizePromoCode('has space')).toBe('');
    expect(normalizePromoCode('drop;table')).toBe('');
    expect(normalizePromoCode('X'.repeat(33))).toBe('');
    expect(normalizePromoCode(null)).toBe('');
    expect(normalizePromoCode(42)).toBe('');
  });
});

describe('calculatePromoDiscount', () => {
  it('percent scope=booking discounts every ticket', () => {
    expect(calculatePromoDiscount({ promo: promo(), ticketPrice: 800, quantity: 5 })).toBe(800); // 20% of 4000
  });
  it('percent scope=first_ticket discounts only one ticket', () => {
    const p = promo({ scope: 'first_ticket' });
    expect(calculatePromoDiscount({ promo: p, ticketPrice: 800, quantity: 5 })).toBe(160);
  });
  it('rounds a percentage to whole rupees', () => {
    const p = promo({ discount_value: 15 });
    expect(calculatePromoDiscount({ promo: p, ticketPrice: 999, quantity: 1 })).toBe(150); // 149.85
  });
  it('honours max_discount as a ceiling on a percentage', () => {
    const p = promo({ discount_value: 50, max_discount: 500 });
    expect(calculatePromoDiscount({ promo: p, ticketPrice: 800, quantity: 4 })).toBe(500); // 1600 capped
    expect(calculatePromoDiscount({ promo: p, ticketPrice: 800, quantity: 1 })).toBe(400); // under the cap
  });
  it('flat discounts the stated amount', () => {
    const p = promo({ discount_type: 'flat', discount_value: 200 });
    expect(calculatePromoDiscount({ promo: p, ticketPrice: 800, quantity: 3 })).toBe(200);
  });
  it('never exceeds what it applies to, so a booking cannot price below zero', () => {
    const p = promo({ discount_type: 'flat', discount_value: 5000 });
    expect(calculatePromoDiscount({ promo: p, ticketPrice: 800, quantity: 2 })).toBe(1600);
    const firstTicket = promo({ discount_type: 'flat', discount_value: 5000, scope: 'first_ticket' });
    expect(calculatePromoDiscount({ promo: firstTicket, ticketPrice: 800, quantity: 2 })).toBe(800);
  });
  it('returns 0 when there is nothing to discount', () => {
    expect(calculatePromoDiscount({ promo: promo(), ticketPrice: 0, quantity: 3 })).toBe(0);
  });
});

describe('evaluatePromo', () => {
  const base = { ticketPrice: 800, quantity: 2, passType: 'oneshot' as const, now: NOW };

  it('accepts a live code and carries its admin-authored message', () => {
    const result = evaluatePromo({ ...base, promo: promo(), redemptions: NO_REDEMPTIONS });
    expect(result).toEqual({
      ok: true,
      id: 'promo-1',
      code: 'SAVE20',
      message: 'Nice — 20% off your order.',
      discount: 320,
    });
  });

  it('refuses a code that does not exist', () => {
    const result = evaluatePromo({ ...base, promo: null, redemptions: NO_REDEMPTIONS });
    expect(result).toEqual({ ok: false, reason: 'promo_not_found' });
  });

  it('refuses a deactivated code', () => {
    const result = evaluatePromo({ ...base, promo: promo({ is_active: false }), redemptions: NO_REDEMPTIONS });
    expect(result).toEqual({ ok: false, reason: 'promo_inactive' });
  });

  it('refuses a code before its window opens and after it closes', () => {
    const early = evaluatePromo({
      ...base,
      promo: promo({ starts_at: '2026-10-01T00:00:00Z' }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(early).toEqual({ ok: false, reason: 'promo_not_started' });

    const late = evaluatePromo({
      ...base,
      promo: promo({ ends_at: '2026-09-01T00:00:00Z' }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(late).toEqual({ ok: false, reason: 'promo_expired' });
  });

  it('treats the end of the window as exclusive', () => {
    const atBoundary = evaluatePromo({
      ...base,
      promo: promo({ ends_at: NOW.toISOString() }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(atBoundary).toEqual({ ok: false, reason: 'promo_expired' });
  });

  it('refuses a code restricted to the other pass type', () => {
    const result = evaluatePromo({
      ...base,
      promo: promo({ pass_type: 'campaign' }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(result).toEqual({ ok: false, reason: 'promo_pass_type' });
  });

  it('refuses a bulk code on a booking under its minimum', () => {
    const result = evaluatePromo({
      ...base,
      quantity: 4,
      promo: promo({ min_quantity: 5 }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(result).toEqual({ ok: false, reason: 'promo_min_quantity' });
  });

  it('accepts a bulk code the moment the booking reaches its minimum', () => {
    const result = evaluatePromo({
      ...base,
      quantity: 5,
      promo: promo({ min_quantity: 5 }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(result).toEqual({
      ok: true,
      id: 'promo-1',
      code: 'SAVE20',
      message: 'Nice — 20% off your order.',
      discount: 800, // 20% of five 800-rupee tickets
    });
  });

  it('weighs the minimum before the redemption caps, so the floor is what is reported', () => {
    const result = evaluatePromo({
      ...base,
      quantity: 1,
      promo: promo({ min_quantity: 5, max_redemptions: 10 }),
      redemptions: { total: 10, forPhone: 4 },
    });
    expect(result).toEqual({ ok: false, reason: 'promo_min_quantity' });
  });

  it('accepts a code restricted to the pass being bought', () => {
    const result = evaluatePromo({
      ...base,
      passType: 'campaign',
      promo: promo({ pass_type: 'campaign' }),
      redemptions: NO_REDEMPTIONS,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses once the total redemption cap is reached', () => {
    const result = evaluatePromo({
      ...base,
      promo: promo({ max_redemptions: 50 }),
      redemptions: { total: 50, forPhone: 0 },
    });
    expect(result).toEqual({ ok: false, reason: 'promo_exhausted' });
  });

  it('allows the last redemption under the cap', () => {
    const result = evaluatePromo({
      ...base,
      promo: promo({ max_redemptions: 50 }),
      redemptions: { total: 49, forPhone: 0 },
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a second use by the same phone when the per-person limit is one', () => {
    const result = evaluatePromo({
      ...base,
      promo: promo(),
      redemptions: { total: 4, forPhone: 1 },
    });
    expect(result).toEqual({ ok: false, reason: 'promo_already_used' });
  });

  it('allows repeat use up to the per-person limit', () => {
    const result = evaluatePromo({
      ...base,
      promo: promo({ max_per_phone: 3 }),
      redemptions: { total: 9, forPhone: 2 },
    });
    expect(result.ok).toBe(true);
  });
});

describe('resolveDiscount', () => {
  it('applies the promo when it beats the Guild Path benefit', () => {
    expect(resolveDiscount({ guildDiscount: 160, promoDiscount: 400 })).toEqual({
      amount: 400, source: 'promo', promoDiscount: 400, guildApplied: false,
    });
  });
  it('keeps the Guild Path benefit when it is larger', () => {
    expect(resolveDiscount({ guildDiscount: 800, promoDiscount: 200 })).toEqual({
      amount: 800, source: 'guild', promoDiscount: 0, guildApplied: true,
    });
  });
  it('breaks a tie in favour of the Guild Path benefit', () => {
    expect(resolveDiscount({ guildDiscount: 300, promoDiscount: 300 })).toEqual({
      amount: 300, source: 'guild', promoDiscount: 0, guildApplied: true,
    });
  });
  it('never stacks the two', () => {
    const resolved = resolveDiscount({ guildDiscount: 500, promoDiscount: 400 });
    expect(resolved.amount).toBe(500);
    expect(resolved.amount).toBeLessThan(500 + 400);
  });
  it('reports no discount when neither applies', () => {
    expect(resolveDiscount({ guildDiscount: 0, promoDiscount: 0 })).toEqual({
      amount: 0, source: null, promoDiscount: 0, guildApplied: false,
    });
  });
});
