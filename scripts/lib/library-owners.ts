// Who lends a game, in the shape `library_title_owners` stores.
//
// Kept out of `src/lib/game-library.ts` on purpose: that module shapes what the
// public page publishes, and lender names must never be part of it.

export interface LenderCopies {
  lender: string;
  count: number;
}

export interface OwnerRow {
  owner: string;
  copies: number;
}

/**
 * One row per lender, summed. A lender can appear more than once for a game —
 * the BGC sheet repeats a row per copy — and the table is keyed on
 * (title, owner), so the counts have to be merged before writing.
 *
 * `names` maps a source name onto what people call them (`library_owner_names`:
 * a BGG username onto a first name). It is applied before merging, so a person
 * who lends through both a BGG collection and the BGC sheet is one owner.
 */
export function ownerRows(copies: LenderCopies[], names: ReadonlyMap<string, string> = new Map()): OwnerRow[] {
  const totals = new Map<string, number>();
  for (const { lender, count } of copies) {
    const source = lender.trim();
    const owner = (names.get(source) ?? source).trim();
    if (!owner || count <= 0) continue;
    totals.set(owner, (totals.get(owner) ?? 0) + count);
  }
  return [...totals]
    .map(([owner, total]) => ({ owner, copies: total }))
    .sort((a, b) => a.owner.localeCompare(b.owner, 'en'));
}
