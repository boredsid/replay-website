import { describe, expect, it } from 'vitest';
import { promoDiscountFor, promoAppliesToPass, winningDiscount, promoErrorMessage } from './promo';
import type { ApiPromoRule } from './types';

function rule(overrides: Partial<ApiPromoRule> = {}): ApiPromoRule {
  return {
    discount_type: 'percent',
    discount_value: 20,
    max_discount: null,
    scope: 'booking',
    pass_type: null,
    ...overrides,
  };
}

describe('promoDiscountFor', () => {
  it('matches the Worker: percent over the whole booking', () => {
    expect(promoDiscountFor({ rule: rule(), ticketPrice: 800, quantity: 5 })).toBe(800);
  });
  it('matches the Worker: percent over the first ticket only', () => {
    expect(promoDiscountFor({ rule: rule({ scope: 'first_ticket' }), ticketPrice: 800, quantity: 5 })).toBe(160);
  });
  it('matches the Worker: rounds to whole rupees', () => {
    expect(promoDiscountFor({ rule: rule({ discount_value: 15 }), ticketPrice: 999, quantity: 1 })).toBe(150);
  });
  it('matches the Worker: applies max_discount as a ceiling', () => {
    const capped = rule({ discount_value: 50, max_discount: 500 });
    expect(promoDiscountFor({ rule: capped, ticketPrice: 800, quantity: 4 })).toBe(500);
  });
  it('matches the Worker: a flat code never exceeds what it applies to', () => {
    const flat = rule({ discount_type: 'flat', discount_value: 5000 });
    expect(promoDiscountFor({ rule: flat, ticketPrice: 800, quantity: 2 })).toBe(1600);
  });
  it('returns 0 when there is nothing to discount', () => {
    expect(promoDiscountFor({ rule: rule(), ticketPrice: 0, quantity: 3 })).toBe(0);
  });
});

describe('promoAppliesToPass', () => {
  it('an unrestricted code applies to either pass', () => {
    expect(promoAppliesToPass(rule(), 'oneshot')).toBe(true);
    expect(promoAppliesToPass(rule(), 'campaign')).toBe(true);
  });
  it('a restricted code applies only to its own pass', () => {
    const campaignOnly = rule({ pass_type: 'campaign' });
    expect(promoAppliesToPass(campaignOnly, 'campaign')).toBe(true);
    expect(promoAppliesToPass(campaignOnly, 'oneshot')).toBe(false);
  });
});

describe('winningDiscount', () => {
  it('takes the promo when it is larger', () => {
    expect(winningDiscount({ guildDiscount: 160, promoDiscount: 400 })).toEqual({ amount: 400, source: 'promo' });
  });
  it('keeps Guild Path when it is larger, and on a tie', () => {
    expect(winningDiscount({ guildDiscount: 800, promoDiscount: 200 })).toEqual({ amount: 800, source: 'guild' });
    expect(winningDiscount({ guildDiscount: 300, promoDiscount: 300 })).toEqual({ amount: 300, source: 'guild' });
  });
  it('reports nothing when neither applies', () => {
    expect(winningDiscount({ guildDiscount: 0, promoDiscount: 0 })).toEqual({ amount: 0, source: null });
  });
});

describe('promoErrorMessage', () => {
  it('turns each refusal reason into attendee-facing copy', () => {
    expect(promoErrorMessage('promo_expired')).toBe('That code has expired.');
    expect(promoErrorMessage('promo_already_used')).toBe("You've already used that code.");
    expect(promoErrorMessage('promo_exhausted')).toBe('That code has been fully claimed.');
  });
  it('falls back for an unknown or missing reason', () => {
    expect(promoErrorMessage('something_else')).toBe("We couldn't check that code. Please retry.");
    expect(promoErrorMessage(undefined)).toBe("We couldn't check that code. Please retry.");
  });
});
