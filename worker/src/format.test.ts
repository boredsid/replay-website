import { describe, expect, it } from 'vitest';
import { editionOrdinal, shortDate, shortDateRange, capitalize } from './format';

describe('editionOrdinal', () => {
  it('returns "1st edition" for replay-1', () => {
    expect(editionOrdinal('replay-1')).toBe('1st edition');
  });
  it('returns "2nd edition" for replay-2', () => {
    expect(editionOrdinal('replay-2')).toBe('2nd edition');
  });
  it('returns "3rd edition" for replay-3', () => {
    expect(editionOrdinal('replay-3')).toBe('3rd edition');
  });
  it('returns "4th edition" for replay-4', () => {
    expect(editionOrdinal('replay-4')).toBe('4th edition');
  });
  it('returns "11th edition" for replay-11', () => {
    expect(editionOrdinal('replay-11')).toBe('11th edition');
  });
  it('returns "12th edition" for replay-12', () => {
    expect(editionOrdinal('replay-12')).toBe('12th edition');
  });
  it('returns "13th edition" for replay-13', () => {
    expect(editionOrdinal('replay-13')).toBe('13th edition');
  });
  it('returns "21st edition" for replay-21', () => {
    expect(editionOrdinal('replay-21')).toBe('21st edition');
  });
  it('returns empty string for malformed slug', () => {
    expect(editionOrdinal('bogus')).toBe('');
    expect(editionOrdinal('')).toBe('');
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
