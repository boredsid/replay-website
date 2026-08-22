import { it, expect } from 'vitest';
import { toCsv } from './csv';

it('renders a header row and quotes separators', () => {
  const csv = toCsv(['name', 'phone'], [['Bo, Jr', '9876543210']]);
  expect(csv).toBe('name,phone\n"Bo, Jr",9876543210\n');
});

it('escapes quotes and blanks out nullish cells', () => {
  const csv = toCsv(['name'], [['He said "hi"'], [null], [undefined]]);
  expect(csv).toBe('name\n"He said ""hi"""\n\n\n');
});

it('defuses spreadsheet formulas', () => {
  expect(toCsv(['name'], [['=cmd()']])).toBe("name\n'=cmd()\n");
});
