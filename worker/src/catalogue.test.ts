import { describe, it, expect } from 'vitest';
import { toCatalogueGame, loadCatalogue } from './catalogue';

const row = {
  id: 't1',
  key: 'bgg-1',
  bgg_id: 1,
  title: 'Catan',
  year: 1995,
  thumb: null,
  description: null,
  min_players: 3,
  max_players: 4,
  min_time: 60,
  max_time: 90,
  rating: '7.12',
  weight: '2.31',
  best_with: [4],
  source: 'bgg',
  copies_override: null,
};

describe('shaping a row for the page', () => {
  /**
   * PostgREST sends `numeric` as a string. The page sorts and filters on these,
   * so a string would sort "10" before "9" and quietly ruin the rating filter.
   */
  it('turns numeric strings into numbers', () => {
    const game = toCatalogueGame(row, 2);
    expect(game.rating).toBe(7.12);
    expect(game.weight).toBe(2.31);
  });

  it('counts the boxes on record', () => {
    expect(toCatalogueGame(row, 3).copies).toBe(3);
  });

  it('prefers a count an admin pinned by hand', () => {
    expect(toCatalogueGame({ ...row, copies_override: 1 }, 3).copies).toBe(1);
  });
});

/** A hand-rolled PostgREST double: enough chain to answer these three queries. */
function client(opts: {
  titles?: unknown[];
  copies?: Array<{ title_id: string }>;
  sources?: unknown[];
  syncedAt?: string;
}) {
  return {
    from: (table: string) => {
      if (table === 'library_titles') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: opts.titles ?? [], error: null }) }),
            }),
          }),
        };
      }
      if (table === 'library_copies') {
        return { select: () => ({ limit: async () => ({ data: opts.copies ?? [], error: null }) }) };
      }
      if (table === 'library_catalogue_meta') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { sources: opts.sources ?? [], synced_at: opts.syncedAt ?? '2026-09-09T00:00:00Z' },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe('the published catalogue', () => {
  it('joins each game to its copies', async () => {
    const snapshot = await loadCatalogue(client({
      titles: [row],
      copies: [{ title_id: 't1' }, { title_id: 't1' }],
    }));
    expect(snapshot.games).toHaveLength(1);
    expect(snapshot.games[0].copies).toBe(2);
  });

  /**
   * A title with no boxes is a card advertising an empty space on the shelf.
   * It happens when every copy has been withdrawn, and it should not publish.
   */
  it('leaves out a game with no copies at all', async () => {
    const snapshot = await loadCatalogue(client({ titles: [row], copies: [] }));
    expect(snapshot.games).toHaveLength(0);
  });

  it('still publishes a game whose count was pinned by hand', async () => {
    const snapshot = await loadCatalogue(client({
      titles: [{ ...row, copies_override: 2 }],
      copies: [],
    }));
    expect(snapshot.games[0].copies).toBe(2);
  });

  it('dates the snapshot from the last sync', async () => {
    const snapshot = await loadCatalogue(client({
      titles: [row],
      copies: [{ title_id: 't1' }],
      syncedAt: '2026-09-08T11:22:33Z',
    }));
    expect(snapshot.generatedAt).toBe('2026-09-08');
  });

  /**
   * The harvest cannot know about a game somebody typed in, so its source card
   * is derived here — and must not appear when nobody has added one.
   */
  it('credits games added by hand, and only when there are some', async () => {
    const withManual = await loadCatalogue(client({
      titles: [row, { ...row, id: 't2', key: 'manual-x', bgg_id: null, source: 'manual' }],
      copies: [{ title_id: 't1' }, { title_id: 't2' }],
      sources: [{ label: 'Personal collections', detail: '4 collectors', count: 684 }],
    }));
    expect(withManual.sources.map((source) => source.label)).toContain('Added by the REPLAY team');
    expect(withManual.sources.at(-1)?.count).toBe(1);

    const without = await loadCatalogue(client({
      titles: [row],
      copies: [{ title_id: 't1' }],
      sources: [{ label: 'Personal collections', detail: '4 collectors', count: 684 }],
    }));
    expect(without.sources.map((source) => source.label)).not.toContain('Added by the REPLAY team');
  });
});
