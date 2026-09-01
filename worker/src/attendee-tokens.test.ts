import { describe, it, expect } from 'vitest';
import {
  bearerToken,
  generateDeviceToken,
  generatePairingCode,
  generateQrToken,
  hashToken,
  isWellFormedPairingCode,
  normalizePairingCode,
} from './attendee-tokens';

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

describe('generatePairingCode', () => {
  it('is eight Crockford characters', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(CROCKFORD);
  });

  it('never emits a character that gets misread', () => {
    // I, L and O are read as 1, 1 and 0 across a desk; U is excluded outright.
    const codes = Array.from({ length: 400 }, generatePairingCode).join('');
    expect(codes).not.toMatch(/[ILOU]/);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, generatePairingCode));
    expect(codes.size).toBe(500);
  });

  it('spreads across the whole alphabet rather than a corner of it', () => {
    // 32 divides 256, so masking the low bits is uniform. If that ever stopped
    // being true the distribution would visibly collapse.
    const seen = new Set(Array.from({ length: 2000 }, generatePairingCode).join(''));
    expect(seen.size).toBe(32);
  });
});

describe('normalizePairingCode', () => {
  it('accepts what someone actually types', () => {
    expect(normalizePairingCode('a1b2-c3d4')).toBe('A1B2C3D4');
    expect(normalizePairingCode(' A1B2 C3D4 ')).toBe('A1B2C3D4');
  });

  it('forgives the confusable characters', () => {
    // Someone reading 0 as O, or 1 as I/L, still gets in.
    expect(normalizePairingCode('O1I2L3')).toBe('011213');
  });

  it('returns empty for anything that is not a string', () => {
    expect(normalizePairingCode(null)).toBe('');
    expect(normalizePairingCode(undefined)).toBe('');
    expect(normalizePairingCode(12345678)).toBe('');
  });

  it('round-trips a freshly minted code', () => {
    const code = generatePairingCode();
    expect(normalizePairingCode(code.toLowerCase())).toBe(code);
  });
});

describe('isWellFormedPairingCode', () => {
  it('accepts a minted code', () => {
    expect(isWellFormedPairingCode(generatePairingCode())).toBe(true);
  });

  it.each([
    ['too short', 'A1B2C3D'],
    ['too long', 'A1B2C3D4E'],
    ['contains a confusable that should have been normalised', 'A1B2C3DO'],
    ['empty', ''],
  ])('rejects one that is %s', (_why, value) => {
    expect(isWellFormedPairingCode(value)).toBe(false);
  });
});

describe('generateDeviceToken', () => {
  it('is url-safe base64 with no padding', () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
  });

  it('carries 256 bits', () => {
    // 32 bytes → 43 base64 characters once padding is stripped.
    expect(generateDeviceToken()).toHaveLength(43);
  });

  it('does not repeat itself', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateDeviceToken));
    expect(tokens.size).toBe(500);
  });
});

describe('generateQrToken', () => {
  it('is opaque Crockford base32 carrying no readable data', () => {
    const token = generateQrToken();
    expect(token).toHaveLength(16);
    expect(token).toMatch(CROCKFORD);
  });

  it('does not repeat itself', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateQrToken));
    expect(tokens.size).toBe(500);
  });
});

describe('hashToken', () => {
  it('produces a 64-character hex digest', async () => {
    expect(await hashToken('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same input', async () => {
    expect(await hashToken('abc')).toBe(await hashToken('abc'));
  });

  it('differs for different inputs', async () => {
    expect(await hashToken('abc')).not.toBe(await hashToken('abd'));
  });

  it('matches the known SHA-256 of "abc"', async () => {
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('bearerToken', () => {
  it('reads a bearer header', () => {
    const req = new Request('https://x', { headers: { Authorization: 'Bearer abc123' } });
    expect(bearerToken(req)).toBe('abc123');
  });

  it('is case-insensitive about the scheme', () => {
    const req = new Request('https://x', { headers: { Authorization: 'bearer abc123' } });
    expect(bearerToken(req)).toBe('abc123');
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Basic abc123'],
    ['scheme only', 'Bearer'],
  ])('returns empty for %s', (_why, value) => {
    const req = new Request('https://x', value ? { headers: { Authorization: value } } : undefined);
    expect(bearerToken(req)).toBe('');
  });
});
