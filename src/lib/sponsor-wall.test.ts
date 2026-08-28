import { describe, expect, it } from 'vitest';
import { buildWall, nameFromFile, nameKey, type SponsorWallRow } from './sponsor-wall';

function row(overrides: Partial<SponsorWallRow> & Pick<SponsorWallRow, 'id' | 'name'>): SponsorWallRow {
  return {
    tier: 'community',
    logo_url: `https://cdn.example/${overrides.id}.png`,
    website_url: null,
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
  it('ranks by the sponsorship ladder, then sorts by name inside a tier', () => {
    const wall = buildWall(
      [
        row({ id: 'a', name: 'Zolives', tier: 'community' }),
        row({ id: 'b', name: 'Indiqube', tier: 'venue' }),
        row({ id: 'c', name: 'Mozaic', tier: 'association' }),
        row({ id: 'd', name: 'Dice Hard', tier: 'association' }),
        row({ id: 'e', name: 'Somo Club', tier: 'title' }),
        row({ id: 'f', name: 'TTRPGcon', tier: 'gaming' }),
        row({ id: 'g', name: 'Board Game Jungle', tier: 'zone' }),
      ],
      [],
    );
    expect(wall.map((entry) => entry.name)).toEqual([
      'Somo Club',          // title
      'Dice Hard',          // association, alphabetical …
      'Mozaic',
      'Indiqube',           // venue
      'Board Game Jungle',  // zone
      'TTRPGcon',           // gaming
      'Zolives',            // community
    ]);
  });

  it('sends a tier it does not recognise to the back rather than dropping it', () => {
    const wall = buildWall(
      [row({ id: 'a', name: 'Retired Tier', tier: 'gold' }), row({ id: 'b', name: 'Zolives' })],
      [],
    );
    expect(wall.map((entry) => entry.name)).toEqual(['Zolives', 'Retired Tier']);
  });

  it('carries the header switch, and treats an unset one as on', () => {
    const wall = buildWall(
      [
        row({ id: 'a', name: 'Somo Club', tier: 'title', show_in_header: false }),
        row({ id: 'b', name: 'Mozaic', tier: 'association' }),
      ],
      ['Legacy Logo.png'],
    );
    expect(wall.map((entry) => [entry.name, entry.inHeader])).toEqual([
      ['Somo Club', false],
      ['Mozaic', true],
      ['Legacy Logo', false],
    ]);
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
