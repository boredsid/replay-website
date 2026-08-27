import { describe, expect, it } from 'vitest';
import {
  durationBand,
  EMPTY_FILTERS,
  filterGames,
  formatPlayers,
  formatTime,
  isFiltered,
  normalizeTitle,
  supportsPlayerCount,
  titleKey,
  titleSlug,
  weightBand,
  type LibraryGame,
} from './game-library';

function game(overrides: Partial<LibraryGame> = {}): LibraryGame {
  return {
    key: 'bgg-1',
    bggId: 1,
    title: 'Test Game',
    year: 2020,
    thumb: null,
    minPlayers: 2,
    maxPlayers: 4,
    minTime: 30,
    maxTime: 60,
    rating: 7.5,
    weight: 2.2,
    bestWith: [3],
    copies: 1,
    ...overrides,
  };
}

describe('normalizeTitle', () => {
  it('folds case, punctuation and accents to one key', () => {
    expect(normalizeTitle('SHASN')).toBe('shasn');
    expect(normalizeTitle('Shasn')).toBe('shasn');
    expect(normalizeTitle('Orléans')).toBe('orleans');
    expect(normalizeTitle('Tzolk’in: The Mayan Calendar')).toBe('tzolk in the mayan calendar');
  });

  it('drops a leading article so "The Crew" and "Crew" agree', () => {
    expect(normalizeTitle('The Red Cathedral')).toBe('red cathedral');
    expect(normalizeTitle('A Game of Thrones')).toBe('game of thrones');
  });

  it('spells out the ampersand both sources disagree on', () => {
    expect(normalizeTitle('Sea Salt & Paper')).toBe(normalizeTitle('Sea Salt and Paper'));
  });

  it('slugs to a URL-safe key', () => {
    expect(titleSlug('The Quacks of Quedlinburg')).toBe('quacks-of-quedlinburg');
  });
});

describe('titleKey', () => {
  it('matches the real BGC/BGG title pairs the merge depends on', () => {
    expect(titleKey('Q.E.')).toBe(titleKey('QE'));
    expect(titleKey('This is Ridiculous')).toBe(titleKey('This is Ridiculous!!!'));
    expect(titleKey('Shasn')).toBe(titleKey('SHASN'));
    expect(titleKey('Sea Salt & Paper')).toBe(titleKey('Sea Salt and Paper'));
    expect(titleKey('boop.')).toBe('boop');
  });

  it('still separates genuinely different games', () => {
    expect(titleKey('Splendor')).not.toBe(titleKey('Splendor Duel'));
    expect(titleKey('Azul')).not.toBe(titleKey('Azul: Summer Pavilion'));
  });
});

describe('weightBand', () => {
  it('splits on the bands the BGC sheet already used', () => {
    expect(weightBand(1.77)).toBe('light');
    expect(weightBand(1.99)).toBe('light');
    expect(weightBand(2)).toBe('medium');
    expect(weightBand(2.4)).toBe('medium');
    expect(weightBand(3)).toBe('heavy');
    expect(weightBand(4.19)).toBe('heavy');
  });

  it('returns null for missing or nonsense weights', () => {
    expect(weightBand(null)).toBeNull();
    expect(weightBand(0)).toBeNull();
    expect(weightBand(Number.NaN)).toBeNull();
  });
});

describe('durationBand', () => {
  it('bands on the longest play time, not the shortest', () => {
    expect(durationBand(15)).toBe('quick');
    expect(durationBand(30)).toBe('quick');
    expect(durationBand(45)).toBe('short');
    expect(durationBand(60)).toBe('short');
    expect(durationBand(120)).toBe('long');
    expect(durationBand(180)).toBe('epic');
  });

  it('returns null when no time is known', () => {
    expect(durationBand(null)).toBeNull();
    expect(durationBand(0)).toBeNull();
  });
});

describe('supportsPlayerCount', () => {
  it('answers within the published range', () => {
    const g = game({ minPlayers: 2, maxPlayers: 4 });
    expect(supportsPlayerCount(g, 1)).toBe(false);
    expect(supportsPlayerCount(g, 2)).toBe(true);
    expect(supportsPlayerCount(g, 4)).toBe(true);
    expect(supportsPlayerCount(g, 5)).toBe(false);
  });

  it('treats the top chip as 8-or-more', () => {
    const party = game({ minPlayers: 6, maxPlayers: 21 });
    const small = game({ minPlayers: 2, maxPlayers: 4 });
    expect(supportsPlayerCount(party, 8)).toBe(true);
    expect(supportsPlayerCount(small, 8)).toBe(false);
  });

  it('is false when neither bound is known', () => {
    expect(supportsPlayerCount(game({ minPlayers: null, maxPlayers: null }), 3)).toBe(false);
  });
});

describe('formatting', () => {
  it('renders player counts', () => {
    expect(formatPlayers(game({ minPlayers: 2, maxPlayers: 4 }))).toBe('2–4');
    expect(formatPlayers(game({ minPlayers: 2, maxPlayers: 2 }))).toBe('2');
    expect(formatPlayers(game({ minPlayers: null, maxPlayers: null }))).toBeNull();
  });

  it('renders play time', () => {
    expect(formatTime(game({ minTime: 30, maxTime: 60 }))).toBe('30–60 min');
    expect(formatTime(game({ minTime: 45, maxTime: 45 }))).toBe('45 min');
    expect(formatTime(game({ minTime: null, maxTime: null }))).toBeNull();
  });

  it('carries a bare copy count, never a lender', () => {
    const shared = game({ copies: 3 });
    expect(shared.copies).toBe(3);
    expect(JSON.stringify(shared)).not.toMatch(/lender/i);
  });
});

describe('filterGames', () => {
  const games = [
    game({ key: 'a', title: 'Azul', minPlayers: 2, maxPlayers: 4, maxTime: 45, weight: 1.77 }),
    game({ key: 'b', title: 'Brass: Birmingham', minPlayers: 2, maxPlayers: 4, maxTime: 120, weight: 3.87 }),
    game({ key: 'c', title: 'Blood on the Clocktower', minPlayers: 6, maxPlayers: 21, maxTime: 120, weight: 3.04 }),
  ];

  it('returns everything when nothing is set', () => {
    expect(filterGames(games, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('searches titles case- and punctuation-insensitively', () => {
    expect(filterGames(games, { ...EMPTY_FILTERS, query: 'brass birmingham' }).map((g) => g.key)).toEqual(['b']);
    expect(filterGames(games, { ...EMPTY_FILTERS, query: 'AZUL' }).map((g) => g.key)).toEqual(['a']);
  });

  it('ORs choices inside a group', () => {
    const result = filterGames(games, { ...EMPTY_FILTERS, weights: ['light', 'heavy'] });
    expect(result.map((g) => g.key).sort()).toEqual(['a', 'b', 'c']);
    expect(filterGames(games, { ...EMPTY_FILTERS, weights: ['medium'] })).toHaveLength(0);
  });

  it('ANDs across groups', () => {
    const result = filterGames(games, { ...EMPTY_FILTERS, players: [8], weights: ['heavy'] });
    expect(result.map((g) => g.key)).toEqual(['c']);
  });

  it('drops games with no data for an active band filter', () => {
    const unknown = [game({ key: 'x', weight: null, maxTime: null })];
    expect(filterGames(unknown, { ...EMPTY_FILTERS, weights: ['light'] })).toHaveLength(0);
    expect(filterGames(unknown, { ...EMPTY_FILTERS, durations: ['quick'] })).toHaveLength(0);
    expect(filterGames(unknown, EMPTY_FILTERS)).toHaveLength(1);
  });
});

describe('isFiltered', () => {
  it('ignores whitespace-only queries', () => {
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTERS, query: '   ' })).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTERS, query: 'azul' })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTERS, players: [2] })).toBe(true);
  });
});
