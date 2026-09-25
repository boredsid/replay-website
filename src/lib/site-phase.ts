// src/lib/site-phase.ts
//
// What the site is about right now: an edition that is coming, one that is
// on, or one that has finished. Decided from the dates, never from a status
// somebody has to remember to flip the morning after teardown.
//
// Two editions matter at any moment:
//   upcoming — the current, published edition, while it has not ended.
//   recap    — the most recent published edition that has ended, current or
//              not. Marking a draft REPLAY 4 current clears REPLAY 3's flag
//              (the single-current trigger), and this is what keeps the site
//              on the REPLAY 3 recap instead of falling into "no edition".
//
// Pure, so the pages and the sponsor-logo normaliser (which runs before Astro
// has booted) reach the same answer from the same rows.
//
// Design: docs/specs/2026-09-24-between-editions-design.md

export type SitePhase = 'pre_event' | 'live' | 'wrapped' | 'none';

/** The fields the phase needs; every edition row type in the site has them. */
export interface PhaseEdition {
  slug: string;
  start_date: string;
  end_date: string;
}

export interface SiteState<E extends PhaseEdition = PhaseEdition> {
  phase: SitePhase;
  /** YYYY-MM-DD in Bengaluru, fixed once per build. */
  today: string;
  upcoming: E | null;
  recap: E | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The calendar date in Bengaluru, as YYYY-MM-DD. */
export function bengaluruDate(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The build's "today".
 *
 * `astro.config.mjs` sets SITE_TODAY once at module scope, so every page and
 * the normaliser in one build agree even if the build runs across midnight.
 * Setting it by hand builds the site as of any date — that is how both phases
 * are checked locally. A value that is not a date stops the build rather than
 * quietly building the wrong phase.
 */
export function siteToday(env: Record<string, string | undefined> = process.env, now = new Date()): string {
  const set = env.SITE_TODAY?.trim();
  if (!set) return bengaluruDate(now);
  if (!ISO_DATE.test(set) || Number.isNaN(Date.parse(`${set}T00:00:00Z`))) {
    throw new Error(`SITE_TODAY must be a date like 2026-09-24, not "${set}"`);
  }
  return set;
}

export function resolveSitePhase<E extends PhaseEdition>(input: {
  /** The current, published edition, if any — whatever its dates. */
  current: E | null;
  /** The most recent published edition whose end_date is before today. */
  latestEnded: E | null;
  today: string;
}): SiteState<E> {
  const { current, latestEnded, today } = input;
  const upcoming = current && current.end_date >= today ? current : null;
  // A current edition that has ended is its own recap; the query that found
  // latestEnded would have found it too, but do not depend on the caller.
  const recap = latestEnded ?? (current && current.end_date < today ? current : null);

  let phase: SitePhase;
  if (upcoming) phase = today >= upcoming.start_date ? 'live' : 'pre_event';
  else if (recap) phase = 'wrapped';
  else phase = 'none';

  return { phase, today, upcoming, recap };
}

/** The edition a page describes when it can describe only one. */
export function displayEdition<E extends PhaseEdition>(state: SiteState<E>): E | null {
  return state.upcoming ?? state.recap;
}

/** "replay-3" → 3. Null for a slug that carries no number. */
export function editionNumber(slug: string): number | null {
  const match = slug.match(/^replay-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * How an edition is named everywhere: "replay-3" → "REPLAY 3E". Plain
 * "REPLAY" when the slug has no number to show. The Worker's emails, calendar
 * entries and invites use the same rule — editionName in worker/src/format.ts;
 * keep them in sync.
 */
export function editionLabel(slug: string): string {
  const n = editionNumber(slug);
  return n === null ? 'REPLAY' : `REPLAY ${n}E`;
}

/** The edition after the recap edition: "REPLAY 4E", or "the next REPLAY". */
export function nextEditionLabel(recapSlug: string | null | undefined): string {
  const n = recapSlug ? editionNumber(recapSlug) : null;
  return n === null ? 'the next REPLAY' : `REPLAY ${n + 1}E`;
}
