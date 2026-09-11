import { describe, expect, it } from 'vitest';
import { ownerRows } from './library-owners';

describe('ownerRows', () => {
  /** The BGC sheet repeats a row per copy; the table holds one row per owner. */
  it('merges repeated lenders into one count', () => {
    expect(
      ownerRows([
        { lender: 'Siddhant', count: 1 },
        { lender: 'Vinto100', count: 1 },
        { lender: 'Siddhant', count: 1 },
      ]),
    ).toEqual([
      { owner: 'Siddhant', copies: 2 },
      { owner: 'Vinto100', copies: 1 },
    ]);
  });

  it('trims names, so a stray space does not split one owner in two', () => {
    expect(ownerRows([{ lender: 'BGC ', count: 1 }, { lender: 'BGC', count: 2 }])).toEqual([{ owner: 'BGC', copies: 3 }]);
  });

  /** The table's check constraints refuse both, and a failed insert would stop the sync. */
  it('drops blank names and empty counts', () => {
    expect(ownerRows([{ lender: '  ', count: 1 }, { lender: 'Amrit', count: 0 }])).toEqual([]);
  });
});
