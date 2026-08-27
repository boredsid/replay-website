// src/lib/sponsor-wall.ts
//
// Which logos the homepage wall shows, in what order, and where each one
// links. Two sources feed it:
//
//   1. `sponsors` rows for the current edition, uploaded through the admin
//      console. These carry a tier, an explicit order and an optional link.
//   2. The `sponsor-logos/` folder committed to the repo — the wall's original
//      source, kept so that artwork nobody has migrated yet still appears.
//
// A row wins over a file of the same name, so migrating a logo is: upload it
// in the console, then delete the file. Nothing shows twice in between.
//
// The judgement lives here rather than in the normaliser script so it can be
// unit-tested without touching the filesystem or the network.

export type SponsorTier = 'title' | 'gold' | 'silver' | 'partner';

const TIER_ORDER: SponsorTier[] = ['title', 'gold', 'silver', 'partner'];

/** The subset of a `sponsors` row the wall reads. */
export interface SponsorWallRow {
  id: string;
  name: string;
  tier: string;
  logo_url: string;
  website_url: string | null;
  display_order: number;
}

export interface WallEntry {
  /** Basename (no extension) of the normalised tile written for this logo. */
  key: string;
  name: string;
  /** Where the tile links, or null for a logo that is not clickable. */
  href: string | null;
  source:
    | { kind: 'remote'; url: string }
    | { kind: 'local'; file: string };
}

/** "Board Game Company.png" → "Board Game Company". */
export function nameFromFile(file: string): string {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose identity for "is this the same sponsor?" across the two sources. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tierRank(tier: string): number {
  const index = TIER_ORDER.indexOf(tier as SponsorTier);
  return index === -1 ? TIER_ORDER.length : index;
}

/** Only http(s) links reach the site; anything else is dropped, not rendered. */
function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Sponsors first — by tier, then by the order an admin set, then by name — and
 * legacy files after them, alphabetically, minus any a sponsor row supersedes.
 */
export function buildWall(rows: SponsorWallRow[], localFiles: string[]): WallEntry[] {
  const ordered = rows
    .filter((row) => row.name?.trim() && row.logo_url?.trim())
    .slice()
    .sort((a, b) =>
      tierRank(a.tier) - tierRank(b.tier)
      || (a.display_order ?? 0) - (b.display_order ?? 0)
      || a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
    );

  const claimed = new Set(ordered.map((row) => nameKey(row.name)));

  const remote: WallEntry[] = ordered.map((row) => ({
    key: row.id,
    name: row.name.trim(),
    href: safeHref(row.website_url),
    source: { kind: 'remote', url: row.logo_url.trim() },
  }));

  const local: WallEntry[] = localFiles
    .map((file) => ({ file, name: nameFromFile(file) }))
    .filter(({ name }) => !claimed.has(nameKey(name)))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }))
    .map(({ file, name }) => ({
      key: nameFromFile(file),
      name,
      href: null,
      source: { kind: 'local' as const, file },
    }));

  return [...remote, ...local];
}
