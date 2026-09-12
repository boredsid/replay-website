/**
 * The console's one text-match rule.
 *
 * Every list that lets somebody type a name filters through here, so a search
 * that finds a game on the catalogue finds a session on the programme in the
 * same way — accents folded away, case ignored, and the typed words allowed to
 * arrive in any order, because at a desk people type the two words they
 * remember rather than the start of the title.
 */

/** Accent- and case-insensitive fold. Matches the public library page's. */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * True when every word of `query` appears somewhere in `fields`.
 *
 * An empty or whitespace-only query matches everything, so a caller can hand
 * the raw input straight in without guarding it first.
 */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter((field): field is string => Boolean(field)).map(fold).join(' ');
  return words.every((word) => haystack.includes(word));
}
