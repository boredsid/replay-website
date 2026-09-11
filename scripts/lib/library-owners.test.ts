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

  /** A BGG username is not what anybody calls them at the desk. */
  it('shows the name an owner goes by, not their BGG username', () => {
    expect(ownerRows([{ lender: 'SomeBggUser', count: 1 }], new Map([['SomeBggUser', 'Asha']]))).toEqual([
      { owner: 'Asha', copies: 1 },
    ]);
  });

  /** One person lending through a collection and the club sheet is one owner. */
  it('merges a renamed owner with the same name from another source', () => {
    expect(
      ownerRows(
        [{ lender: 'SomeBggUser', count: 1 }, { lender: 'Asha', count: 1 }],
        new Map([['SomeBggUser', 'Asha']]),
      ),
    ).toEqual([{ owner: 'Asha', copies: 2 }]);
  });

  it('leaves an owner with no mapping as the source spells them', () => {
    expect(ownerRows([{ lender: 'BGC', count: 1 }], new Map([['SomeBggUser', 'Asha']]))).toEqual([
      { owner: 'BGC', copies: 1 },
    ]);
  });

  /** The table's check constraints refuse both, and a failed insert would stop the sync. */
  it('drops blank names and empty counts', () => {
    expect(ownerRows([{ lender: '  ', count: 1 }, { lender: 'Amrit', count: 0 }])).toEqual([]);
  });
});
