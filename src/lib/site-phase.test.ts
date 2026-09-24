import { describe, expect, it } from 'vitest';
import {
  bengaluruDate,
  displayEdition,
  editionLabel,
  editionNumber,
  nextEditionLabel,
  resolveSitePhase,
  siteToday,
} from './site-phase';

const REPLAY_3 = { slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13' };
const REPLAY_4 = { slug: 'replay-4', start_date: '2027-02-06', end_date: '2027-02-07' };
const TODAY = '2026-09-24';

describe('resolveSitePhase — the spec state table', () => {
  it('REPLAY 3 current and ended, no REPLAY 4 yet: wrapped on REPLAY 3', () => {
    const state = resolveSitePhase({ current: REPLAY_3, latestEnded: REPLAY_3, today: TODAY });
    expect(state).toEqual({ phase: 'wrapped', today: TODAY, upcoming: null, recap: REPLAY_3 });
  });

  it('REPLAY 4 drafted but neither published nor current: still wrapped on REPLAY 3', () => {
    // A draft is invisible to the anon client, so the inputs are the same as above.
    const state = resolveSitePhase({ current: REPLAY_3, latestEnded: REPLAY_3, today: TODAY });
    expect(state.phase).toBe('wrapped');
    expect(state.recap).toBe(REPLAY_3);
  });

  it('REPLAY 4 marked current but unpublished: no current edition is visible, and the site stays wrapped', () => {
    // The single-current trigger cleared REPLAY 3's flag; the unpublished
    // REPLAY 4 is invisible. Before this model the site had no edition here.
    const state = resolveSitePhase({ current: null, latestEnded: REPLAY_3, today: TODAY });
    expect(state).toEqual({ phase: 'wrapped', today: TODAY, upcoming: null, recap: REPLAY_3 });
  });

  it('REPLAY 4 published and current: pre_event, with REPLAY 3 still available as the recap', () => {
    const state = resolveSitePhase({ current: REPLAY_4, latestEnded: REPLAY_3, today: TODAY });
    expect(state).toEqual({ phase: 'pre_event', today: TODAY, upcoming: REPLAY_4, recap: REPLAY_3 });
  });
});

describe('resolveSitePhase — edges', () => {
  it('is live from the first event day to the last, inclusive', () => {
    for (const today of ['2026-09-12', '2026-09-13']) {
      expect(resolveSitePhase({ current: REPLAY_3, latestEnded: null, today }).phase).toBe('live');
    }
  });

  it('is pre_event the day before and wrapped the day after', () => {
    expect(resolveSitePhase({ current: REPLAY_3, latestEnded: null, today: '2026-09-11' }).phase).toBe('pre_event');
    expect(resolveSitePhase({ current: REPLAY_3, latestEnded: null, today: '2026-09-14' }).phase).toBe('wrapped');
  });

  it('treats a current edition that has ended as its own recap, even if the caller found none', () => {
    expect(resolveSitePhase({ current: REPLAY_3, latestEnded: null, today: TODAY }).recap).toBe(REPLAY_3);
  });

  it('is none on an empty database', () => {
    expect(resolveSitePhase({ current: null, latestEnded: null, today: TODAY }))
      .toEqual({ phase: 'none', today: TODAY, upcoming: null, recap: null });
  });

  it('describes the upcoming edition when there is one, else the recap', () => {
    expect(displayEdition(resolveSitePhase({ current: REPLAY_4, latestEnded: REPLAY_3, today: TODAY }))).toBe(REPLAY_4);
    expect(displayEdition(resolveSitePhase({ current: null, latestEnded: REPLAY_3, today: TODAY }))).toBe(REPLAY_3);
    expect(displayEdition(resolveSitePhase({ current: null, latestEnded: null, today: TODAY }))).toBeNull();
  });
});

describe('siteToday', () => {
  it('uses SITE_TODAY when it is set', () => {
    expect(siteToday({ SITE_TODAY: '2026-09-10' })).toBe('2026-09-10');
  });

  it('otherwise uses the date in Bengaluru, which runs ahead of UTC', () => {
    expect(siteToday({}, new Date('2026-09-13T21:30:00Z'))).toBe('2026-09-14');
    expect(siteToday({ SITE_TODAY: '  ' }, new Date('2026-09-13T12:00:00Z'))).toBe('2026-09-13');
  });

  it('stops the build rather than guess when SITE_TODAY is not a date', () => {
    expect(() => siteToday({ SITE_TODAY: 'yesterday' })).toThrow(/SITE_TODAY/);
    expect(() => siteToday({ SITE_TODAY: '2026-9-24' })).toThrow(/SITE_TODAY/);
  });

  it('crosses midnight in Bengaluru, not in UTC', () => {
    expect(bengaluruDate(new Date('2026-09-13T18:29:59Z'))).toBe('2026-09-13');
    expect(bengaluruDate(new Date('2026-09-13T18:30:00Z'))).toBe('2026-09-14');
  });
});

describe('edition names', () => {
  it('numbers editions from their slug', () => {
    expect(editionNumber('replay-3')).toBe(3);
    expect(editionNumber('replay-mini')).toBeNull();
    expect(editionLabel('replay-3')).toBe('REPLAY 3');
    expect(editionLabel('special')).toBe('REPLAY');
  });

  it('names the next edition after the recap', () => {
    expect(nextEditionLabel('replay-3')).toBe('REPLAY 4');
    expect(nextEditionLabel('replay-mini')).toBe('the next REPLAY');
    expect(nextEditionLabel(null)).toBe('the next REPLAY');
  });
});
