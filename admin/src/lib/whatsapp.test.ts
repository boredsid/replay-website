import { it, expect } from 'vitest';
import { waNumber, formatPhone, leadWhatsappUrl } from './whatsapp';

it('prefixes the country code only when missing', () => {
  expect(waNumber('9876543210')).toBe('919876543210');
  expect(waNumber('+91 98765 43210')).toBe('919876543210');
});

it('formats stored 10-digit numbers for display', () => {
  expect(formatPhone('9876543210')).toBe('+91 98765 43210');
});

it('greets the lead by name when known', () => {
  expect(leadWhatsappUrl('9876543210', 'Bo')).toContain('https://wa.me/919876543210?text=Hi%20Bo!');
  expect(leadWhatsappUrl('9876543210', null)).toContain('text=Hi!');
});
