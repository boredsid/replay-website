import { describe, expect, it } from 'vitest';
import { recapCredit, recapView, rupees, type RecapInput } from './recap';
import type { RecapResponse, ScheduleItemRow } from './types';

const PARTNER_PRICING = { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 };

const REPLAY_3 = {
  slug: 'replay-3',
  start_date: '2026-09-12',
  end_date: '2026-09-13',
  venue: 'Indiqube Symphony, MG Road',
  partner_pricing: PARTNER_PRICING,
  photos_url: null as string | null,
};

// REPLAY 3E's real figures on 24 September 2026.
const RECAP: RecapResponse = {
  edition: { slug: 'replay-3', start_date: '2026-09-12', end_date: '2026-09-13' },
  attendance: { people: 285, by_day: { day1: 154, day2: 185 }, both_days: 54 },
  tickets: { across_days: 446, by_day: { day1: 200, day2: 246 } },
  sessions: { seats_booked: 286, sessions_booked: 38, by_item: [{ schedule_item_id: 'quiz', booked: 30 }] },
  library: {
    loans: 145,
    most_borrowed: [
      { title: 'Hot Streak', loans: 7 },
      { title: 'Skull', loans: 6 },
      { title: 'Trio', loans: 6 },
      { title: 'boop.', loans: 5 },
      { title: 'Magical Athlete', loans: 5 },
    ],
  },
};

function item(id: string, overrides: Partial<ScheduleItemRow> = {}): ScheduleItemRow {
  return {
    id, edition_id: 'ed-3', day: '2026-09-13', start_time: '18:00:00', end_time: '19:30:00',
    title: id, description: null, location: null, kind: 'quiz', section: 'programme', is_all_day: false,
    host_name: null, signup_mode: 'app', public_status: 'published', display_order: 0,
    ...overrides,
  };
}

const PROGRAMME = [
  item('quiz', { title: '“Wait, I know this…” Quiz', host_name: 'The Kyu Co.' }),
  ...Array.from({ length: 68 }, (_, i) => item(`item-${i}`)),
  item('draft-only', { public_status: 'draft' }),
];

const SPONSORS: RecapInput['sponsors'] = [
  { name: 'Meeple Syrup', tier: 'association', show_in_header: true },
  ...Array.from({ length: 23 }, (_, i) => ({ name: `Partner ${i}`, tier: 'community' as const })),
];

const base: RecapInput = { edition: REPLAY_3, recap: RECAP, scheduleItems: PROGRAMME, shelfCount: 585, sponsors: SPONSORS };

describe('recapView — REPLAY 3E', () => {
  const view = recapView(base);

  it('says what the mock says', () => {
    expect(view.label).toBe('REPLAY 3E');
    expect(view.nextLabel).toBe('REPLAY 4E');
    expect(view.eyebrow).toBe('That was REPLAY 3E · Sep 12–13, 2026 · Indiqube Symphony, MG Road');
    expect(view.headline).toBe('446 tickets across two days.');
    expect(view.sub).toBe('Two days at Indiqube Symphony, MG Road. 200 on Saturday, 246 on Sunday.');
  });

  it('shows six figures, counting only published programme items', () => {
    expect(view.tiles).toEqual([
      { value: 446, label: 'tickets across two days' },
      { value: 69, label: 'things on the programme' },
      { value: 286, label: 'seats booked across 38 sessions' },
      { value: 145, label: 'games borrowed from the library' },
      { value: 585, label: 'games on the shelf' },
      { value: 24, label: 'partners on the floor' },
    ]);
  });

  it('ranks the most borrowed games against the top one', () => {
    expect(view.mostBorrowed?.map((g) => [g.title, g.loans])).toEqual([
      ['Hot Streak', 7], ['Skull', 6], ['Trio', 6], ['boop.', 5], ['Magical Athlete', 5],
    ]);
    expect(view.mostBorrowed?.[0].share).toBe(1);
    expect(view.mostBorrowed?.[3].share).toBeCloseTo(5 / 7);
  });

  it('names the fullest session with its day, time and host', () => {
    expect(view.fullest).toEqual({ title: '“Wait, I know this…” Quiz', when: 'Sunday, 6 PM', host: 'The Kyu Co.', booked: 30 });
  });

  it('moves the header credit into the recap', () => {
    expect(view.credit).toBe('Made in association with Meeple Syrup.');
  });

  it('leads with dates for the next edition, then what was on', () => {
    expect(view.links).toEqual([
      { text: 'Get REPLAY 4E dates first →', href: '/tickets' },
      { text: 'What was on →', href: '/schedule' },
    ]);
  });

  it('gives the pre-event "Last time" line', () => {
    expect(view.lastTimeLine).toEqual({ text: 'Last time: 446 tickets across two days at REPLAY 3E.', photos: null });
  });

  it('cites tickets, never the unique head count', () => {
    expect(view.tickets).toBe(446);
    expect(view.ticketsLabel).toBe('tickets across two days');
    expect(JSON.stringify(view)).not.toMatch(/\b285\b|people|players/i);
  });

  it('quotes the cheaper booth for Get involved', () => {
    expect(view.cheapestBooth).toBe(6500);
    expect(rupees(view.cheapestBooth)).toBe('₹6,500');
  });
});

describe('recapView — with an album', () => {
  const view = recapView({ ...base, edition: { ...REPLAY_3, photos_url: 'https://photos.app.goo.gl/2oKWtdKCofYAGhUa6' } });

  it('links to the photos from the band and the "Last time" line', () => {
    expect(view.links.map((l) => l.href)).toEqual(['/tickets', '/photos', '/schedule']);
    expect(view.lastTimeLine?.photos).toEqual({ text: 'See the photos →', href: '/photos' });
  });
});

describe('recapView — an imported edition: tickets, but no app data', () => {
  const REPLAY_2 = { ...REPLAY_3, slug: 'replay-2', start_date: '2026-04-18', end_date: '2026-04-19', venue: 'The Bangalore Local, Koramangala' };
  const IMPORTED: RecapResponse = {
    edition: { slug: 'replay-2', start_date: '2026-04-18', end_date: '2026-04-19' },
    attendance: { people: 0, by_day: {}, both_days: 0 },
    tickets: { across_days: 145, by_day: { day1: 75, day2: 70 } },
    sessions: { seats_booked: 0, sessions_booked: 0, by_item: [] },
    library: { loans: 0, most_borrowed: [] },
  };
  const view = recapView({ edition: REPLAY_2, recap: IMPORTED, scheduleItems: [], shelfCount: 585, sponsors: [] });

  it('leads with its tickets and shows no zero', () => {
    expect(view.headline).toBe('145 tickets across two days.');
    expect(view.sub).toBe('Two days at The Bangalore Local, Koramangala. 75 on Saturday, 70 on Sunday.');
    expect(view.tiles).toEqual([
      { value: 145, label: 'tickets across two days' },
      { value: 585, label: 'games on the shelf' },
    ]);
    expect(view.lastTimeLine?.text).toBe('Last time: 145 tickets across two days at REPLAY 2E.');
  });
});

describe('recapView — an edition with no figures at all', () => {
  const REPLAY_2 = { ...REPLAY_3, slug: 'replay-2', start_date: '2026-04-18', end_date: '2026-04-19', venue: 'The Bangalore Local, Koramangala' };
  const EMPTY: RecapResponse = {
    edition: { slug: 'replay-2', start_date: '2026-04-18', end_date: '2026-04-19' },
    attendance: { people: 0, by_day: {}, both_days: 0 },
    sessions: { seats_booked: 0, sessions_booked: 0, by_item: [] },
    library: { loans: 0, most_borrowed: [] },
  };
  const view = recapView({ edition: REPLAY_2, recap: EMPTY, scheduleItems: [], shelfCount: 585, sponsors: [] });

  it('falls back to naming the edition, and shows no zero', () => {
    expect(view.headline).toBe('That was REPLAY 2E.');
    expect(view.sub).toBe('Two days at The Bangalore Local, Koramangala.');
    expect(view.tiles).toEqual([{ value: 585, label: 'games on the shelf' }]);
    expect(view.mostBorrowed).toBeNull();
    expect(view.fullest).toBeNull();
    expect(view.credit).toBeNull();
    expect(view.tickets).toBeNull();
  });

  it('has no "Last time" line without a ticket figure', () => {
    expect(view.lastTimeLine).toBeNull();
  });
});

describe('recapView — when the Worker could not be reached', () => {
  const view = recapView({ ...base, recap: null });

  it('still names the edition and keeps its links', () => {
    expect(view.headline).toBe('That was REPLAY 3E.');
    expect(view.eyebrow).toBe('REPLAY 3E · Sep 12–13, 2026 · Indiqube Symphony, MG Road');
    expect(view.sub).toBe('Two days at Indiqube Symphony, MG Road.');
    expect(view.links[0]).toEqual({ text: 'Get REPLAY 4E dates first →', href: '/tickets' });
    expect(view.tiles.map((t) => t.label)).toEqual(['things on the programme', 'games on the shelf', 'partners on the floor']);
  });
});

describe('recapView — smaller cases', () => {
  it('hides "Most borrowed" with only two titles', () => {
    const recap = { ...RECAP, library: { loans: 3, most_borrowed: RECAP.library.most_borrowed.slice(0, 2) } };
    expect(recapView({ ...base, recap }).mostBorrowed).toBeNull();
  });

  it('says "in one day", with no day split, for a one-day edition', () => {
    const mini = { ...REPLAY_3, slug: 'replay-1', start_date: '2026-01-31', end_date: '2026-01-31' };
    const recap = { ...RECAP, tickets: { across_days: 46, by_day: { day1: 46 } } };
    const view = recapView({ ...base, edition: mini, recap });
    expect(view.headline).toBe('46 tickets in one day.');
    expect(view.sub).toBe('One day at Indiqube Symphony, MG Road.');
  });

  it('falls back to the edition name for a Worker that predates the ticket figure, rather than citing people', () => {
    const { tickets: _omitted, ...older } = RECAP;
    const view = recapView({ ...base, recap: older });
    expect(view.headline).toBe('That was REPLAY 3E.');
    expect(view.tiles[0]).toEqual({ value: 69, label: 'things on the programme' });
  });

  it('has no fullest session when the busiest one is not on the published programme', () => {
    const recap = { ...RECAP, sessions: { ...RECAP.sessions, by_item: [{ schedule_item_id: 'draft-only', booked: 9 }] } };
    expect(recapView({ ...base, recap }).fullest).toBeNull();
  });

  it('says "the next REPLAY" when the slug carries no number', () => {
    const view = recapView({ ...base, edition: { ...REPLAY_3, slug: 'replay-special' } });
    expect(view.links[0].text).toBe('Get the next REPLAY dates first →');
  });

  it('leaves out a venue that was never confirmed', () => {
    const view = recapView({ ...base, edition: { ...REPLAY_3, venue: 'TBD' } });
    expect(view.eyebrow).toBe('That was REPLAY 3E · Sep 12–13, 2026');
    expect(view.sub).toBe('200 on Saturday, 246 on Sunday.');
  });
});

describe('recapCredit', () => {
  it('credits a title sponsor, an association sponsor, or both', () => {
    expect(recapCredit([{ name: 'Acme', tier: 'title' }])).toBe('Presented by Acme.');
    expect(recapCredit([{ name: 'Acme', tier: 'title' }, { name: 'Meeple Syrup', tier: 'association' }]))
      .toBe('Presented by Acme, in association with Meeple Syrup.');
  });

  it('does not credit a sponsor switched off for the lockup, or any other tier', () => {
    expect(recapCredit([{ name: 'Held back', tier: 'association', show_in_header: false }])).toBeNull();
    expect(recapCredit([{ name: 'Indiqube', tier: 'venue', show_in_header: true }])).toBeNull();
  });
});
