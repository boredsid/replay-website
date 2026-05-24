// worker/src/format.ts
// Pure display-string helpers used to render values in user-facing
// surfaces (currently: email templates). No I/O.

/**
 * "replay-3" → "3rd edition", "replay-21" → "21st edition". Empty string if slug doesn't match.
 * Mirrors src/lib/data.ts editionOrdinal — keep in sync.
 */
export function editionOrdinal(slug: string): string {
  const n = parseInt(String(slug).replace(/^replay-/, ''), 10);
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] || s[v] || s[0];
  return `${n}${suffix} edition`;
}
