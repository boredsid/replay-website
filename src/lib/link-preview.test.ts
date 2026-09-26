import { describe, expect, it } from 'vitest';
import {
  LINK_PREVIEW_TAGLINE,
  linkPreviewContent,
  previewDateRange,
  previewDayNote,
  splitVenue,
  wrapToLines,
  wrappedLinkPreviewContent,
} from './link-preview';
import type { EditionRow } from './types';

const edition = (overrides: Partial<EditionRow> = {}): EditionRow =>
  ({
    id: 'edition-id',
    slug: 'replay-3',
    name: 'REPLAY',
    start_date: '2026-09-12',
    end_date: '2026-09-13',
    daily_start_time: '09:00:00',
    daily_end_time: '21:00:00',
    venue: 'Indiqube Symphony, MG Road',
    capacity_per_day: { day1: 100, day2: 100 },
    pricing: { oneshot: 500, campaign: 800 },
    partner_pricing: {
      gst_rate: 0.18,
      standard_booth: 0,
      community_booth: 0,
      standard_engagement: 0,
      patron_engagement: 0,
    },
    registration_status: 'open',
    is_current: true,
    is_published: true,
    ...overrides,
  }) as EditionRow;

describe('previewDateRange', () => {
  it('collapses a range inside one month', () => {
    expect(previewDateRange('2026-09-12', '2026-09-13')).toBe('SEP 12–13');
  });

  it('names both months when the range straddles one', () => {
    expect(previewDateRange('2026-10-31', '2026-11-01')).toBe('OCT 31 – NOV 1');
  });

  it('names both months when the range straddles a year', () => {
    expect(previewDateRange('2026-12-31', '2027-01-01')).toBe('DEC 31 – JAN 1');
  });

  it('prints a single day once', () => {
    expect(previewDateRange('2026-01-31', '2026-01-31')).toBe('JAN 31');
  });

  it('falls back to the raw values when a date is unparseable', () => {
    expect(previewDateRange('soon', '2026-09-13')).toBe('soon – 2026-09-13');
  });
});

describe('previewDayNote', () => {
  it('pairs the weekday names of a two-day edition', () => {
    expect(previewDayNote('2026-09-12', '2026-09-13')).toBe('SAT & SUN');
  });

  it('prints one weekday for a one-day edition', () => {
    expect(previewDayNote('2026-01-31', '2026-01-31')).toBe('SAT');
  });

  it('still pairs a two-day edition that lands on the same weekday name', () => {
    expect(previewDayNote('2026-09-12', '2026-09-19')).toBe('SAT & SAT');
  });

  it('is empty rather than wrong when a date is unparseable', () => {
    expect(previewDayNote('soon', 'later')).toBe('');
  });
});

describe('splitVenue', () => {
  it('splits the locality off the venue name', () => {
    expect(splitVenue('Indiqube Symphony, MG Road')).toEqual({ name: 'Indiqube Symphony', locality: 'MG Road' });
  });

  it('splits on the last comma so a comma inside the name survives', () => {
    expect(splitVenue('The Bangalore Local, 5th Block, Koramangala')).toEqual({
      name: 'The Bangalore Local, 5th Block',
      locality: 'Koramangala',
    });
  });

  it('defaults the locality to Bangalore when the venue has none', () => {
    expect(splitVenue('The Bangalore Local')).toEqual({ name: 'The Bangalore Local', locality: 'Bangalore' });
  });

  it('reads TBD as an announcement, not a venue name', () => {
    expect(splitVenue('TBD')).toEqual({ name: 'Venue to be announced', locality: 'Bangalore' });
    expect(splitVenue('  ')).toEqual({ name: 'Venue to be announced', locality: 'Bangalore' });
  });
});

describe('wrapToLines', () => {
  it('leaves short text on one line', () => {
    expect(wrapToLines('MG ROAD', 18, 2)).toEqual(['MG ROAD']);
  });

  it('balances a long name across two lines', () => {
    expect(wrapToLines('THE BANGALORE LOCAL', 18, 2)).toEqual(['THE BANGALORE', 'LOCAL']);
  });

  it('never exceeds the line budget, even when the text will not fit', () => {
    const lines = wrapToLines('A VERY LONG CONVENTION VENUE NAME INDEED', 18, 2);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe('A VERY LONG CONVENTION VENUE NAME INDEED');
  });

  it('keeps an unbreakable single word intact', () => {
    expect(wrapToLines('SUPERCALIFRAGILISTIC', 10, 2)).toEqual(['SUPERCALIFRAGILISTIC']);
  });
});

describe('linkPreviewContent', () => {
  it('sets the tagline the card is meant to carry', () => {
    expect(LINK_PREVIEW_TAGLINE).toBe('Bangalore’s Offline Gaming Convention');
  });

  it('builds the card from the current edition', () => {
    expect(linkPreviewContent(edition())).toEqual({
      eyebrow: 'REPLAY 3E',
      tagline: LINK_PREVIEW_TAGLINE,
      when: { label: 'WHEN', value: ['SEP 12–13'], note: 'SAT & SUN' },
      where: { label: 'WHERE', value: ['INDIQUBE SYMPHONY'], note: 'MG ROAD' },
    });
  });

  it('wraps a long venue name onto two lines', () => {
    const content = linkPreviewContent(edition({ venue: 'The Bangalore Local, Koramangala' }));
    expect(content.where).toEqual({ label: 'WHERE', value: ['THE BANGALORE', 'LOCAL'], note: 'KORAMANGALA' });
  });

  it('announces an unset venue instead of printing TBD', () => {
    const content = linkPreviewContent(edition({ venue: 'TBD' }));
    expect(content.where).toEqual({ label: 'WHERE', value: ['VENUE TO BE', 'ANNOUNCED'], note: 'BANGALORE' });
  });

  it('falls back to the wordmark and tagline when no edition is published', () => {
    expect(linkPreviewContent(null)).toEqual({
      eyebrow: null,
      tagline: LINK_PREVIEW_TAGLINE,
      when: null,
      where: null,
    });
  });
});

describe('wrappedLinkPreviewContent', () => {
  const REPLAY_3 = { slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13' };

  it('says what REPLAY 3E added up to, and that REPLAY 4E has no dates yet', () => {
    expect(wrappedLinkPreviewContent({ ...REPLAY_3, tickets: 446 })).toEqual({
      eyebrow: 'THAT WAS REPLAY 3E',
      tagline: LINK_PREVIEW_TAGLINE,
      when: { label: 'LAST TIME', value: ['446 TICKETS'], note: 'SEP 12–13, 2026' },
      where: { label: 'NEXT', value: ['REPLAY 4E'], note: 'DATES SOON' },
    });
  });

  it('falls back to the dates when there is no ticket figure', () => {
    const content = wrappedLinkPreviewContent({ ...REPLAY_3, slug: 'replay-2', start_date: '2026-04-18', end_date: '2026-04-19', tickets: null });
    expect(content.eyebrow).toBe('THAT WAS REPLAY 2E');
    expect(content.when).toEqual({ label: 'LAST TIME', value: ['APR 18–19'], note: 'SAT & SUN' });
    expect(content.where?.value).toEqual(['REPLAY 3E']);
  });

  it('names "the next REPLAY" when the slug carries no number', () => {
    expect(wrappedLinkPreviewContent({ ...REPLAY_3, slug: 'replay-special', tickets: 10 }).where?.value).toEqual(['THE NEXT REPLAY']);
  });
});
