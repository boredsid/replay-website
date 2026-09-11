import type { CatalogueOwner } from './types';

/** "Siddhant, Vinto100 ×2" — the multiplier only where somebody lends more than one. */
export function formatOwners(owners: CatalogueOwner[] | undefined): string {
  return (owners ?? [])
    .map(({ owner, copies }) => (copies > 1 ? `${owner} ×${copies}` : owner))
    .join(', ');
}
