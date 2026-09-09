import { describe, it, expect } from 'vitest';
import { parseBggRef, flattenBestWith, toDetail } from './bgg';

describe('reading a BoardGameGeek reference', () => {
  it('takes a bare id', () => {
    expect(parseBggRef('194655')).toBe(194655);
    expect(parseBggRef('  194655  ')).toBe(194655);
  });

  it('takes the URL somebody actually has open', () => {
    expect(parseBggRef('https://boardgamegeek.com/boardgame/194655/santorini')).toBe(194655);
  });

  /**
   * The reason there is no search box: BGG's search page answers 403 to
   * anything that is not a browser, so pasting a link is the whole mechanism.
   * An expansion URL has to work or half the shelf cannot be added.
   */
  it('takes an expansion or RPG URL, not just board games', () => {
    expect(parseBggRef('https://boardgamegeek.com/boardgameexpansion/240909/kingdomino-age-of-giants')).toBe(240909);
    expect(parseBggRef('https://boardgamegeek.com/rpgitem/311654/alice-is-missing')).toBe(311654);
  });

  it('refuses what is not a reference at all', () => {
    expect(parseBggRef('')).toBeNull();
    expect(parseBggRef('Santorini')).toBeNull();
    expect(parseBggRef('0')).toBeNull();
    expect(parseBggRef('https://example.com/boardgame/1/x')).toBeNull();
  });
});

describe('the best-player-count poll', () => {
  it('flattens a range into the counts a filter chip works in', () => {
    expect(flattenBestWith([{ min: 3, max: 4 }])).toEqual([3, 4]);
  });

  it('merges overlapping ranges without repeating a count', () => {
    expect(flattenBestWith([{ min: 2, max: 3 }, { min: 3, max: 4 }])).toEqual([2, 3, 4]);
  });

  it('ignores a party game claiming it is best at ninety-nine', () => {
    expect(flattenBestWith([{ min: 2, max: 99 }])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('survives a poll that is missing or malformed', () => {
    expect(flattenBestWith(undefined)).toEqual([]);
    expect(flattenBestWith([{ min: undefined }])).toEqual([]);
  });
});

describe('shaping the two responses into a box', () => {
  const item = {
    item: {
      name: 'Santorini',
      yearpublished: '2016',
      images: { thumb: 'https://cf.geekdo-images.com/x.jpg' },
      minplayers: '2',
      maxplayers: '4',
      minplaytime: '20',
      maxplaytime: '20',
    },
  };
  const dynamic = { item: { stats: { average: '7.6543', avgweight: '1.7891' }, polls: { userplayers: { best: [{ min: 2, max: 2 }] } } } };

  it('rounds a rating to one place and a weight to two', () => {
    const detail = toDetail(item, dynamic);
    expect(detail.rating).toBe(7.7);
    expect(detail.weight).toBe(1.79);
  });

  it('reads the box', () => {
    expect(toDetail(item, dynamic)).toMatchObject({
      name: 'Santorini',
      year: 2016,
      minPlayers: 2,
      maxPlayers: 4,
      bestWith: [2],
    });
  });

  /** An id BGG does not know comes back shaped but empty; the name is the tell. */
  it('gives an empty name for a response with no item', () => {
    expect(toDetail({}, {}).name).toBe('');
  });
});
