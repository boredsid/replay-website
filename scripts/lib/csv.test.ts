import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const rows = parseCsv('a,b\n1,2\n3,4\n');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    const rows = parseCsv('name,detail\nChai,"a, b, c"\n');
    expect(rows[0]).toEqual({ name: 'Chai', detail: 'a, b, c' });
  });

  it('handles embedded newlines and escaped quotes inside quotes', () => {
    const csv = 'name,json\nP,"[{""x"":1},\n{""y"":2}]"\n';
    const rows = parseCsv(csv);
    expect(rows[0].name).toBe('P');
    expect(rows[0].json).toBe('[{"x":1},\n{"y":2}]');
  });

  it('trims header and cell whitespace and skips blank trailing lines', () => {
    const rows = parseCsv('a , b\n 1 , 2 \n\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('parses the last row when there is no trailing newline', () => {
    const rows = parseCsv('a,b\n1,2');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });
});
