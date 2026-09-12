import { describe, expect, it } from 'vitest';
import { fold, matchesSearch } from './search';

describe('fold', () => {
  it('drops case and accents', () => {
    expect(fold('Pokémon')).toBe('pokemon');
    expect(fold('CATAN')).toBe('catan');
  });
});

describe('matchesSearch', () => {
  it('matches everything when nothing is typed', () => {
    expect(matchesSearch('', 'Werewolf')).toBe(true);
    expect(matchesSearch('   ', 'Werewolf')).toBe(true);
  });

  it('matches inside a title, whatever the case', () => {
    expect(matchesSearch('wolf', 'Werewolf')).toBe(true);
    expect(matchesSearch('WERE', 'Werewolf')).toBe(true);
    expect(matchesSearch('quiz', 'Werewolf')).toBe(false);
  });

  it('takes the typed words in any order', () => {
    expect(matchesSearch('night quiz', 'Quiz Night')).toBe(true);
    expect(matchesSearch('quiz  night', 'Quiz Night')).toBe(true);
    expect(matchesSearch('quiz morning', 'Quiz Night')).toBe(false);
  });

  it('searches across every field it is given, skipping the absent ones', () => {
    expect(matchesSearch('table 3', 'Werewolf', null, 'Table 3')).toBe(true);
    expect(matchesSearch('priya', 'Werewolf', undefined)).toBe(false);
  });
});
