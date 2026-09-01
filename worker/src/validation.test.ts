import { describe, expect, it } from 'vitest';
import {
  sanitizePhone,
  parseDays,
  parsePassType,
  parseStepReached,
  jsonResponse,
  CORS_HEADERS,
} from './validation';

describe('sanitizePhone', () => {
  it('strips non-digits and returns last 10', () => {
    expect(sanitizePhone('+91 98765 43210')).toBe('9876543210');
    expect(sanitizePhone('91-9876543210')).toBe('9876543210');
    expect(sanitizePhone('9876543210')).toBe('9876543210');
  });
  it('returns empty string when fewer than 10 digits', () => {
    expect(sanitizePhone('12345')).toBe('');
    expect(sanitizePhone('')).toBe('');
    expect(sanitizePhone('abc')).toBe('');
  });
  it('handles undefined/null defensively', () => {
    expect(sanitizePhone(undefined as any)).toBe('');
    expect(sanitizePhone(null as any)).toBe('');
  });
});

describe('parseDays', () => {
  it('accepts valid arrays', () => {
    expect(parseDays(['day1'])).toEqual(['day1']);
    expect(parseDays(['day2'])).toEqual(['day2']);
    expect(parseDays(['day1', 'day2'])).toEqual(['day1', 'day2']);
  });
  it('rejects empty / non-array / unknown values', () => {
    expect(parseDays([])).toBeNull();
    expect(parseDays('day1')).toBeNull();
    expect(parseDays(['day3'])).toBeNull();
    expect(parseDays(['day1', 'day3'])).toBeNull();
    expect(parseDays(null)).toBeNull();
  });
  it('rejects duplicates', () => {
    expect(parseDays(['day1', 'day1'])).toBeNull();
  });
});

describe('parsePassType', () => {
  it('accepts oneshot and campaign', () => {
    expect(parsePassType('oneshot')).toBe('oneshot');
    expect(parsePassType('campaign')).toBe('campaign');
  });
  it('rejects anything else', () => {
    expect(parsePassType('annual')).toBeNull();
    expect(parsePassType('')).toBeNull();
    expect(parsePassType(undefined)).toBeNull();
  });
});

describe('parseStepReached', () => {
  it('accepts the three known steps', () => {
    expect(parseStepReached('phone_entered')).toBe('phone_entered');
    expect(parseStepReached('name_entered')).toBe('name_entered');
    expect(parseStepReached('details_entered')).toBe('details_entered');
  });
  it('rejects anything else', () => {
    expect(parseStepReached('bogus')).toBeNull();
    expect(parseStepReached('')).toBeNull();
  });
});

describe('jsonResponse', () => {
  it('returns Response with JSON content-type, CORS, and default 200', async () => {
    const res = jsonResponse({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ hello: 'world' });
  });
  it('honors custom status', async () => {
    const res = jsonResponse({ error: 'no' }, 400);
    expect(res.status).toBe(400);
  });
});

describe('CORS_HEADERS', () => {
  it('allows every method the attendee app actually uses', () => {
    const allowed = CORS_HEADERS['Access-Control-Allow-Methods'].split(',');
    // Cancelling a booking is DELETE and changing push preferences is PATCH.
    // Both are cross-origin, so a missing method here stops them at preflight.
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(allowed).toContain(method);
    }
  });

  it('allows the Authorization header device tokens travel in', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization');
  });
});
