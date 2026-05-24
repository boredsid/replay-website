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

/** "2026-09-12" → "Sep 12" (no year, no locale weirdness).
 * Mirrors src/lib/data.ts shortDate — keep in sync. */
export function shortDate(iso: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}`;
}

/** "2026-09-12" + "2026-09-13" → "Sep 12 – Sep 13".
 * Mirrors src/lib/data.ts shortDateRange — keep in sync. */
export function shortDateRange(start: string, end: string): string {
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/** "guildmaster" → "Guildmaster". Empty string → empty string. */
export function capitalize(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
