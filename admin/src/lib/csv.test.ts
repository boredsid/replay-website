import { describe, it, expect } from 'vitest';
import { toCsv, arrivalsToCsv } from './csv';

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

describe('arrivalsToCsv', () => {
  const row = {
    name: 'Priya',
    phone: '9876543210',
    seat_index: 1,
    is_purchaser: true,
    purchaser_name: 'Priya Nair',
    purchaser_phone: '9876543210',
    purchaser_email: 'priya@example.com',
    pass_type: 'campaign',
    days: ['day1', 'day2'],
    state: { day1: 'in', day2: null },
    arrived_at: { day1: '2026-09-12T04:30:00.000Z', day2: null },
  };

  it('carries the number in full, unlike the door roster', () => {
    const csv = arrivalsToCsv([row]);
    expect(csv).toContain('9876543210');
    expect(csv).not.toContain('••••');
  });

  it('keeps the buyer in their own column on a guest seat', () => {
    // The attendee's phone stays blank rather than borrowing the buyer's, so
    // nobody rings a number believing it belongs to the person named beside it.
    const csv = arrivalsToCsv([{ ...row, name: 'Rahul', phone: null, is_purchaser: false }]);
    const line = csv.split('\n')[1];
    expect(line.startsWith('Rahul,,1,guest,Priya Nair,9876543210')).toBe(true);
  });

  it('says "not arrived" for a day covered but not used, and n/a for one not bought', () => {
    const csv = arrivalsToCsv([{ ...row, days: ['day1'], state: { day1: 'in', day2: null } }]);
    expect(csv.trim().split('\n')[1].endsWith(',in,,n/a')).toBe(true);
  });
});
