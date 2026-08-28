// src/lib/header-lockup.ts
//
// The billing lockup in the site header: “X presents REPLAY in association
// with Y”. Both credits are promised by the tiers in `src/lib/sponsor-tiers.ts`
// — “the lockup on every creative, the site header and the ticket page” — so
// the header reads them off the same sponsor rows the logo wall renders, and
// the credit appears the moment a sponsor is given that tier in the admin
// console. With neither tier sold the header is the REPLAY wordmark alone,
// exactly as before.

/** The two fields the lockup selects on. Keeps this testable without images. */
interface TieredLogo {
  tier: string;
  /** The console's per-sponsor switch; see `sponsors.show_in_header`. */
  inHeader: boolean;
}

export interface HeaderLockup<T extends TieredLogo> {
  /** The title sponsor: “<presenter> presents REPLAY”. */
  presenter: T | null;
  /** The association sponsor: “REPLAY in association with <associate>”. */
  associate: T | null;
  /** False when neither tier is sold, i.e. the header shows the wordmark alone. */
  hasCredits: boolean;
}

/**
 * Both tiers are exclusive — one brand each — so the first match wins. Logos
 * arrive from `buildWall` already ordered by tier, which puts the title
 * sponsor first; nothing here depends on that, it just reads naturally.
 *
 * A sponsor switched out of the header in the console keeps its tier and its
 * place on the logo wall; it simply does not appear here.
 */
export function headerLockup<T extends TieredLogo>(logos: T[]): HeaderLockup<T> {
  const credited = logos.filter((logo) => logo.inHeader);
  const presenter = credited.find((logo) => logo.tier === 'title') ?? null;
  const associate = credited.find((logo) => logo.tier === 'association') ?? null;
  return { presenter, associate, hasCredits: presenter !== null || associate !== null };
}
