import { describe, it, expect, vi, beforeEach } from 'vitest';
import { foldTitle, handleCataloguePatch, handleCatalogueCreate } from './catalogue';
import { titleKey } from '../../../src/lib/game-library';

vi.mock('./audit', () => ({
  writeAudit: vi.fn(async () => {}),
  diffRows: (before: Record<string, unknown>, after: Record<string, unknown>) => ({ before, after }),
}));

const env = {} as never;
const origin = 'https://admin.replaycon.in';

describe('folding a title', () => {
  /**
   * The alias table is written here and read by scripts/sync-game-library.ts,
   * which folds with `titleKey`. If the two ever disagree, an alias recorded in
   * the admin silently never matches and the duplicate card it was meant to fix
   * comes straight back on the next harvest. This is that guard.
   */
  it('agrees with titleKey, which the sync uses', () => {
    for (const title of [
      'The Quacks of Quedlinburg',
      'Q.E.',
      'Vallamkali: Boat Races of Alappuzha',
      'Wingspan & Friends',
      'A Light Game',
      'Café Racer',
      'boop.',
    ]) {
      expect(foldTitle(title)).toBe(titleKey(title));
    }
  });
});

/** Minimal PostgREST double, recording what was written. */
function client(row: Record<string, unknown> | null, sink: Record<string, unknown> = {}) {
  const chain = {
    update: (patch: Record<string, unknown>) => {
      Object.assign(sink, patch);
      return {
        eq: () => ({
          select: () => ({ single: async () => ({ data: { ...(row ?? {}), ...patch }, error: null }) }),
        }),
      };
    },
    insert: (patch: Record<string, unknown>) => {
      Object.assign(sink, patch);
      return { select: () => ({ single: async () => ({ data: { id: 'new', ...patch }, error: null }) }) };
    },
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: row, error: null }),
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
      limit: async () => ({ data: [], error: null }),
    }),
  };
  return { from: () => chain } as never;
}

const body = (payload: unknown) =>
  new Request('https://api/api/admin/catalogue/x', { method: 'PATCH', body: JSON.stringify(payload) });

describe('taking a game off the shelf', () => {
  const row = { id: 'x', key: 'bgg-1', title: 'Catan', source: 'bgg', shelf_status: 'on_shelf', copies_override: null };
  let sink: Record<string, unknown>;
  beforeEach(() => { sink = {}; });

  /**
   * The same rule as withdrawing a copy at the desk: a removal nobody can
   * explain is a removal nobody can confidently undo.
   */
  it('refuses a removal with no reason', async () => {
    const response = await handleCataloguePatch(body({ shelf_status: 'off_shelf' }), env, client(row, sink), 'x', 'a@b.c', origin);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'note_required' });
  });

  it('records who removed it and when', async () => {
    const response = await handleCataloguePatch(
      body({ shelf_status: 'off_shelf', off_shelf_note: 'not coming' }), env, client(row, sink), 'x', 'a@b.c', origin,
    );
    expect(response.status).toBe(200);
    expect(sink).toMatchObject({ shelf_status: 'off_shelf', off_shelf_note: 'not coming', off_shelf_by: 'a@b.c' });
    expect(sink.off_shelf_at).toEqual(expect.any(String));
  });

  /** The check constraint requires it, and a stale note would explain nothing. */
  it('clears the reason when it goes back', async () => {
    await handleCataloguePatch(body({ shelf_status: 'on_shelf' }), env, client({ ...row, shelf_status: 'off_shelf' }, sink), 'x', 'a@b.c', origin);
    expect(sink).toMatchObject({ shelf_status: 'on_shelf', off_shelf_note: null, off_shelf_at: null, off_shelf_by: null });
  });
});

describe('pinning a copy count', () => {
  const row = { id: 'x', key: 'bgg-1', title: 'Catan', source: 'bgg', shelf_status: 'on_shelf', copies_override: null };
  let sink: Record<string, unknown>;
  beforeEach(() => { sink = {}; });

  it('takes a number', async () => {
    await handleCataloguePatch(body({ copies_override: 2 }), env, client(row, sink), 'x', 'a@b.c', origin);
    expect(sink.copies_override).toBe(2);
  });

  it('takes null, meaning go back to counting boxes', async () => {
    await handleCataloguePatch(body({ copies_override: null }), env, client(row, sink), 'x', 'a@b.c', origin);
    expect(sink.copies_override).toBeNull();
  });

  /**
   * Nought is not a count. A game nobody is bringing goes off the shelf, where
   * it stays visible and can be put back; a zero here would publish a card
   * advertising an empty space.
   */
  it('refuses nought', async () => {
    const response = await handleCataloguePatch(body({ copies_override: 0 }), env, client(row, sink), 'x', 'a@b.c', origin);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_copies' });
  });
});

describe('what a sync owns', () => {
  let sink: Record<string, unknown>;
  beforeEach(() => { sink = {}; });

  /**
   * The whole design is one owner per column. Letting the console edit a title
   * the next harvest will overwrite would ship a control that quietly undoes
   * itself, which is worse than not offering it.
   */
  it('ignores a title change on a harvested row', async () => {
    const row = { id: 'x', key: 'bgg-1', title: 'Catan', source: 'bgg', shelf_status: 'on_shelf', copies_override: null };
    const response = await handleCataloguePatch(body({ title: 'Renamed' }), env, client(row, sink), 'x', 'a@b.c', origin);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'nothing_to_update' });
    expect(sink.title).toBeUndefined();
  });

  it('lets a hand-added row be edited freely', async () => {
    const row = { id: 'x', key: 'manual-x', title: 'Prototype', source: 'manual', shelf_status: 'on_shelf', copies_override: null };
    await handleCataloguePatch(body({ title: 'Prototype v2', max_players: 6 }), env, client(row, sink), 'x', 'a@b.c', origin);
    expect(sink).toMatchObject({ title: 'Prototype v2', max_players: 6 });
  });
});

describe('adding a game by hand', () => {
  let sink: Record<string, unknown>;
  beforeEach(() => { sink = {}; });

  it('needs a title', async () => {
    const request = new Request('https://api/api/admin/catalogue', {
      method: 'POST',
      body: JSON.stringify({ mode: 'manual', title: '  ' }),
    });
    const response = await handleCatalogueCreate(request, env, client(null, sink), 'a@b.c', origin);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'title_required' });
  });

  /** `source: 'manual'` is what stops the next harvest touching it. */
  it('marks it as hand-added so no sync can overwrite it', async () => {
    const request = new Request('https://api/api/admin/catalogue', {
      method: 'POST',
      body: JSON.stringify({ mode: 'manual', title: 'Studio Prototype', copies: 2 }),
    });
    const response = await handleCatalogueCreate(request, env, client(null, sink), 'a@b.c', origin);
    expect(response.status).toBe(200);
    expect(sink).toMatchObject({ source: 'manual', title: 'Studio Prototype', bgg_id: null });
    expect(String(sink.key)).toMatch(/^manual-/);
  });

  it('refuses a copy count that is not a sane number of boxes', async () => {
    for (const copies of [0, -1, 51, 'lots']) {
      const request = new Request('https://api/api/admin/catalogue', {
        method: 'POST',
        body: JSON.stringify({ mode: 'manual', title: 'X', copies }),
      });
      const response = await handleCatalogueCreate(request, env, client(null, sink), 'a@b.c', origin);
      expect(response.status).toBe(400);
    }
  });
});
