import { describe, it, expect } from 'vitest';
import { diffRows } from './audit';

describe('diffRows', () => {
  it('returns only changed keys as {old,new}', () => {
    const before = { a: 1, b: 'x', c: true };
    const after = { a: 2, b: 'x', c: false };
    expect(diffRows(before, after)).toEqual({ a: { old: 1, new: 2 }, c: { old: true, new: false } });
  });
  it('returns empty object when nothing changed', () => {
    expect(diffRows({ a: 1 }, { a: 1 })).toEqual({});
  });
});
