import { describe, expect, it } from 'vitest';
import { editionOrdinal } from './format';

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
