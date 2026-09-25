import { describe, expect, it } from 'vitest';
import { editionName, shortDate, shortDateRange, capitalize } from './format';

describe('editionName', () => {
  it('names every edition "REPLAY <n>E"', () => {
    expect(editionName('replay-1')).toBe('REPLAY 1E');
    expect(editionName('replay-2')).toBe('REPLAY 2E');
    expect(editionName('replay-3')).toBe('REPLAY 3E');
    expect(editionName('replay-4')).toBe('REPLAY 4E');
    expect(editionName('replay-11')).toBe('REPLAY 11E');
    expect(editionName('replay-21')).toBe('REPLAY 21E');
  });

  it('falls back to plain "REPLAY" for a slug without a number', () => {
    expect(editionName('bogus')).toBe('REPLAY');
    expect(editionName('replay-3-draft')).toBe('REPLAY');
    expect(editionName('')).toBe('REPLAY');
  });
});

describe('shortDate', () => {
  it('formats ISO date as Mmm d', () => {
    expect(shortDate('2026-09-12')).toBe('Sep 12');
    expect(shortDate('2026-01-05')).toBe('Jan 5');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
  });
  it('returns input unchanged for malformed input', () => {
    expect(shortDate('not a date')).toBe('not a date');
    expect(shortDate('')).toBe('');
  });
});

describe('shortDateRange', () => {
  it('joins two short dates with an en-dash', () => {
    expect(shortDateRange('2026-09-12', '2026-09-13')).toBe('Sep 12 – Sep 13');
  });
});

describe('capitalize', () => {
  it('uppercases the first letter', () => {
    expect(capitalize('guildmaster')).toBe('Guildmaster');
    expect(capitalize('adventurer')).toBe('Adventurer');
    expect(capitalize('initiate')).toBe('Initiate');
  });
  it('returns empty string for empty input', () => {
    expect(capitalize('')).toBe('');
  });
  it('leaves already-capitalised input alone', () => {
    expect(capitalize('REPLAY')).toBe('REPLAY');
  });
});
