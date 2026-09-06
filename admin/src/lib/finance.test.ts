import { describe, expect, it } from 'vitest';
import { breakEven } from './finance';
import { navFor, mobileMoreFor } from '@/components/nav';

describe('finance estimates and access', () => {
  it('rounds up paid registrations and subtracts marginal costs', () => {
    expect(breakEven(1400.01, 700, 0)).toBe(3);
    expect(breakEven(1500, 700, 200)).toBe(3);
    expect(breakEven(0, 0, 0)).toBe(0);
    expect(breakEven(100, 500, 500)).toBeNull();
    expect(breakEven(100, -2, 0)).toBeNull();
    expect(breakEven(100, 700, -2)).toBeNull();
    expect(breakEven(100, NaN, 0)).toBeNull();
  });
  it('offers finance on desktop and mobile only to full and basic admins', () => {
    for (const role of ['admin', 'basic_admin', 'library', 'check_in', 'programme']) {
      expect(navFor([role]).some((n) => n.to === '/finance')).toBe(['admin', 'basic_admin'].includes(role));
      expect(mobileMoreFor([role]).some((n) => n.to === '/finance')).toBe(['admin', 'basic_admin'].includes(role));
    }
  });
});
