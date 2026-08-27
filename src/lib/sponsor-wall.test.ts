import { describe, expect, it } from 'vitest';
import { buildWall, nameFromFile, nameKey, type SponsorWallRow } from './sponsor-wall';

function row(overrides: Partial<SponsorWallRow> & Pick<SponsorWallRow, 'id' | 'name'>): SponsorWallRow {
  return {
    tier: 'partner',
    logo_url: `https://cdn.example/${overrides.id}.png`,
    website_url: null,
    display_order: 0,
    ...overrides,
  };
}

describe('nameFromFile', () => {
  it('reads a sponsor name out of a filename', () => {
    expect(nameFromFile('Board Game Company.png')).toBe('Board Game Company');
    expect(nameFromFile('the_kyu-co.jpeg')).toBe('the kyu co');
  });
});

describe('buildWall', () => {
  it('orders sponsors by tier, then admin order, then name', () => {
    const wall = buildWall(
      [
        row({ id: 'a', name: 'Zolives', tier: 'partner' }),
        row({ id: 'b', name: 'Indiqube', tier: 'title' }),
        row({ id: 'c', name: 'Mozaic', tier: 'gold', display_order: 2 }),
        row({ id: 'd', name: 'Dice Hard', tier: 'gold', display_order: 1 }),
      ],
      [],
    );
    expect(wall.map((entry) => entry.name)).toEqual(['Indiqube', 'Dice Hard', 'Mozaic', 'Zolives']);
  });

  it('names each tile after the sponsor id so two sponsors never collide', () => {
    const wall = buildWall([row({ id: 'uuid-1', name: 'Somo Club' })], []);
    expect(wall[0]).toMatchObject({ key: 'uuid-1', source: { kind: 'remote', url: 'https://cdn.example/uuid-1.png' } });
  });

  it('keeps legacy files after the uploaded sponsors, alphabetically', () => {
    const wall = buildWall(
      [row({ id: 'a', name: 'Indiqube', tier: 'title' })],
      ['VIPO.jpeg', 'Dice Hard.png'],
    );
    expect(wall.map((entry) => entry.name)).toEqual(['Indiqube', 'Dice Hard', 'VIPO']);
    expect(wall[1].source).toEqual({ kind: 'local', file: 'Dice Hard.png' });
  });

  it('drops a legacy file once a sponsor row covers the same name', () => {
    const wall = buildWall(
      [row({ id: 'a', name: 'Owls on Board' })],
      ['Owls On Board.jpeg', 'Zolives.png'],
    );
    expect(wall.map((entry) => entry.name)).toEqual(['Owls on Board', 'Zolives']);
  });

  it('carries an http link through and refuses anything else', () => {
    const wall = buildWall(
      [
        row({ id: 'a', name: 'Linked', website_url: 'https://example.com/shop' }),
        row({ id: 'b', name: 'Hostile', website_url: 'javascript:alert(1)' }),
        row({ id: 'c', name: 'Plain', website_url: null }),
      ],
      [],
    );
    expect(Object.fromEntries(wall.map((entry) => [entry.name, entry.href]))).toEqual({
      Linked: 'https://example.com/shop',
      Hostile: null,
      Plain: null,
    });
  });

  it('skips a row with no artwork rather than rendering a broken tile', () => {
    const wall = buildWall([row({ id: 'a', name: 'Half-entered', logo_url: '' })], []);
    expect(wall).toEqual([]);
  });

  it('treats punctuation and case as noise when matching the two sources', () => {
    expect(nameKey('The Kyu Co.')).toBe(nameKey('the-kyu-co'));
  });
});
