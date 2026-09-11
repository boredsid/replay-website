// Curating the shelf.
//
// Until this existed, taking a game off the library page was a pull request:
// edit a TSV, run a ~1,000-request BoardGameGeek merge, commit a regenerated
// JSON file, open a PR. `library_titles` is now the catalogue itself, and this
// is how somebody without a checkout changes it.
//
// The rule the whole design rests on is one owner per column. A sync may
// rewrite BoardGameGeek metadata; it may never touch `shelf_status`,
// `off_shelf_*`, `copies_override`, or any column of a row whose `source` is
// 'manual'. That is what makes a hand-added game safe from the next harvest,
// and an admin's decision safe from the next sync.
//
// Nothing here deletes. `service_role` has no `delete` on `library_titles` by
// design — "every ending is a status, never a disappearance" — so a game that
// should not be listed goes off the shelf, where it stays visible and can be
// put back.
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { parseBggRef, fetchBggDetail, type BggDetail } from '../bgg';

/**
 * Fold a title down to a comparison key.
 *
 * Ported from `titleKey` in src/lib/game-library.ts, which the sync uses to
 * join a BGC sheet row onto a BoardGameGeek card. An alias recorded here is
 * read by that sync, so the two have to fold identically or the alias silently
 * never matches.
 */
export function foldTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .replace(/ /g, '');
}

const LIST_COLUMNS =
  'id, key, bgg_id, title, year, thumb, min_players, max_players, min_time, max_time, ' +
  'rating, weight, best_with, source, shelf_status, off_shelf_note, off_shelf_at, ' +
  'off_shelf_by, copies_override, updated_at';

interface Row {
  id: string;
  key: string;
  bgg_id: number | null;
  title: string;
  source: string;
  shelf_status: string;
  copies_override: number | null;
  [key: string]: unknown;
}

/** How many boxes exist per title, so the list can show the real count. */
async function copyCounts(sb: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await sb.from('library_copies').select('title_id, status').limit(20000);
  if (error) throw new Error('copies_query_failed');
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { title_id: string }[]) {
    counts.set(row.title_id, (counts.get(row.title_id) ?? 0) + 1);
  }
  return counts;
}

export interface TitleOwner {
  owner: string;
  copies: number;
}

/**
 * Who lends each title, from `library_title_owners`.
 *
 * Admin-only by construction: GET /api/catalogue never reads that table, so
 * these names cannot reach the public page or the attendee app. A title with
 * no rows — anything added by hand — comes back with an empty list.
 */
async function titleOwners(sb: SupabaseClient, titleId?: string): Promise<Map<string, TitleOwner[]>> {
  let query = sb.from('library_title_owners').select('title_id, owner, copies');
  if (titleId) query = query.eq('title_id', titleId);
  const { data, error } = await query.order('owner').limit(20000);
  if (error) throw new Error('owners_query_failed');
  const owners = new Map<string, TitleOwner[]>();
  for (const row of (data ?? []) as { title_id: string; owner: string; copies: number }[]) {
    const list = owners.get(row.title_id) ?? [];
    list.push({ owner: row.owner, copies: row.copies });
    owners.set(row.title_id, list);
  }
  return owners;
}

/**
 * GET /api/admin/catalogue
 *
 * Everything, on and off the shelf, because the off-shelf list is half the
 * point — a game removed by mistake has to be findable to be put back.
 * `description` is left out: it is ~300 characters across ~590 rows and the
 * list never shows it.
 */
export async function handleCatalogueList(
  _req: Request,
  _env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const titles = await sb
    .from('library_titles')
    .select(LIST_COLUMNS)
    .order('title', { ascending: true })
    .limit(5000);
  if (titles.error) return adminJson({ error: 'query_failed' }, 500, origin);

  let counts: Map<string, number>;
  let owners: Map<string, TitleOwner[]>;
  try {
    [counts, owners] = await Promise.all([copyCounts(sb), titleOwners(sb)]);
  } catch {
    return adminJson({ error: 'query_failed' }, 500, origin);
  }

  const rows = (titles.data ?? []) as unknown as Row[];
  const games = rows.map((row) => ({
    ...row,
    copies_actual: counts.get(row.id) ?? 0,
    copies: row.copies_override ?? counts.get(row.id) ?? 0,
    owners: owners.get(row.id) ?? [],
  }));

  return adminJson(
    {
      games,
      // What the public page would show if it were rebuilt now, so the admin
      // can see the effect of a removal without leaving the screen.
      on_shelf: games.filter((g) => g.shelf_status === 'on_shelf' && g.copies > 0).length,
    },
    200,
    origin,
  );
}

/** GET /api/admin/catalogue/:id — one game, with its description and aliases. */
export async function handleCatalogueGet(
  _req: Request,
  _env: Env,
  sb: SupabaseClient,
  id: string,
  origin: string,
): Promise<Response> {
  const { data, error } = await sb
    .from('library_titles')
    .select(`${LIST_COLUMNS}, description`)
    .eq('id', id)
    .maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);

  const row = data as unknown as Row;
  const counts = await copyCounts(sb).catch(() => new Map<string, number>());
  const owners = await titleOwners(sb, row.id).catch(() => new Map<string, TitleOwner[]>());

  // Aliases pointing at this game explain why a differently-spelled club title
  // lands here, which is otherwise invisible and looks like a bug.
  const aliases = row.bgg_id
    ? await sb.from('library_title_aliases').select('folded_title, note').eq('bgg_id', row.bgg_id)
    : { data: [] as unknown[] };

  return adminJson(
    {
      game: {
        ...row,
        copies_actual: counts.get(row.id) ?? 0,
        copies: row.copies_override ?? counts.get(row.id) ?? 0,
        owners: owners.get(row.id) ?? [],
      },
      aliases: aliases.data ?? [],
    },
    200,
    origin,
  );
}

/**
 * POST /api/admin/catalogue/lookup — { ref }
 *
 * `ref` is a BoardGameGeek id or any BGG URL. There is no search by name:
 * `geeksearch.php` answers 403 to anything that is not a browser, so the page
 * asks for something a person can copy out of their address bar instead of
 * pretending to offer a search that cannot work.
 */
export async function handleCatalogueLookup(
  req: Request,
  _env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { ref?: string } | null;
  const bggId = parseBggRef(String(body?.ref ?? ''));
  if (!bggId) return adminJson({ error: 'invalid_ref' }, 400, origin);

  let detail: BggDetail;
  try {
    detail = await fetchBggDetail(bggId);
  } catch (error) {
    const message = (error as Error).message;
    return adminJson(
      { error: message === 'bgg_not_found' ? 'bgg_not_found' : 'bgg_unavailable' },
      message === 'bgg_not_found' ? 404 : 502,
      origin,
    );
  }

  // Say so before they add a duplicate, and say which row it is so they can go
  // and look at it.
  const existing = await sb
    .from('library_titles')
    .select('id, title, shelf_status')
    .eq('bgg_id', bggId)
    .maybeSingle();

  return adminJson({ bgg_id: bggId, detail, existing: existing.data ?? null }, 200, origin);
}

function detailColumns(bggId: number, detail: BggDetail) {
  return {
    bgg_id: bggId,
    title: detail.name,
    year: detail.year,
    thumb: detail.thumb,
    min_players: detail.minPlayers,
    max_players: detail.maxPlayers,
    min_time: detail.minTime,
    max_time: detail.maxTime,
    rating: detail.rating,
    weight: detail.weight,
    best_with: detail.bestWith,
  };
}

/** 1..n rows for a title, continuing after whatever is already there. */
async function addCopies(sb: SupabaseClient, titleId: string, wanted: number): Promise<void> {
  const { data } = await sb
    .from('library_copies')
    .select('copy_number')
    .eq('title_id', titleId)
    .order('copy_number', { ascending: false })
    .limit(1);
  const highest = ((data ?? [])[0] as { copy_number: number } | undefined)?.copy_number ?? 0;
  const rows = Array.from({ length: wanted }, (_, index) => ({
    title_id: titleId,
    copy_number: highest + index + 1,
  }));
  if (rows.length) await sb.from('library_copies').insert(rows);
}

function readCopies(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) return null;
  return parsed;
}

/**
 * POST /api/admin/catalogue
 *
 *   { mode: 'bgg', ref, copies }        a game BoardGameGeek knows
 *   { mode: 'manual', title, ... }      a REPLAY box, a prototype, a local
 *                                       publisher BGG has never listed
 *
 * A manual row carries `source: 'manual'`, which is what keeps the next
 * harvest from deleting it.
 */
export async function handleCatalogueCreate(
  req: Request,
  _env: Env,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return adminJson({ error: 'invalid_body' }, 400, origin);

  const copies = readCopies(body.copies ?? 1);
  if (copies === null) return adminJson({ error: 'invalid_copies' }, 400, origin);

  let row: Record<string, unknown>;

  if (body.mode === 'bgg') {
    const bggId = parseBggRef(String(body.ref ?? ''));
    if (!bggId) return adminJson({ error: 'invalid_ref' }, 400, origin);

    const clash = await sb.from('library_titles').select('id').eq('bgg_id', bggId).maybeSingle();
    if (clash.data) return adminJson({ error: 'already_in_catalogue' }, 409, origin);

    let detail: BggDetail;
    try {
      detail = await fetchBggDetail(bggId);
    } catch (error) {
      const message = (error as Error).message;
      return adminJson(
        { error: message === 'bgg_not_found' ? 'bgg_not_found' : 'bgg_unavailable' },
        message === 'bgg_not_found' ? 404 : 502,
        origin,
      );
    }
    // `bgg-<id>` is the key the sync would give it, so a harvest that later
    // finds the same game in a collection joins this row instead of making a
    // second card.
    row = { key: `bgg-${bggId}`, source: 'bgg', ...detailColumns(bggId, detail) };
  } else if (body.mode === 'manual') {
    const title = String(body.title ?? '').trim();
    if (!title) return adminJson({ error: 'title_required' }, 400, origin);
    row = {
      key: `manual-${foldTitle(title) || crypto.randomUUID().slice(0, 8)}`,
      source: 'manual',
      bgg_id: null,
      title,
      year: body.year === null || body.year === undefined || body.year === '' ? null : Number(body.year),
      min_players: body.min_players ? Number(body.min_players) : null,
      max_players: body.max_players ? Number(body.max_players) : null,
      min_time: body.min_time ? Number(body.min_time) : null,
      max_time: body.max_time ? Number(body.max_time) : null,
      description: body.description ? String(body.description).slice(0, 400) : null,
    };
  } else {
    return adminJson({ error: 'invalid_mode' }, 400, origin);
  }

  const inserted = await sb.from('library_titles').insert(row).select().single();
  if (inserted.error || !inserted.data) {
    // A duplicate key is the one failure worth naming: it means this game is
    // already on the list under the key the sync would have given it.
    const duplicate = inserted.error?.message?.includes('duplicate key');
    return adminJson({ error: duplicate ? 'already_in_catalogue' : 'insert_failed' }, duplicate ? 409 : 500, origin);
  }

  const id = (inserted.data as { id: string }).id;
  await addCopies(sb, id, copies);
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'catalogue.create',
    target_table: 'library_titles',
    target_id: id,
    diff: { ...inserted.data, copies },
  });
  return adminJson({ ok: true, game: inserted.data }, 200, origin);
}

/**
 * PATCH /api/admin/catalogue/:id
 *
 * Only the admin-owned columns, plus the descriptive fields of a manual row.
 * A sync-owned column on a 'bgg' or 'bgc' row is not editable here — it would
 * be silently reverted by the next harvest, and a setting that quietly undoes
 * itself is worse than one that is not offered.
 */
export async function handleCataloguePatch(
  req: Request,
  _env: Env,
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return adminJson({ error: 'invalid_body' }, 400, origin);

  const before = await sb.from('library_titles').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);
  const current = before.data as unknown as Row;

  const patch: Record<string, unknown> = {};

  if (body.shelf_status !== undefined) {
    const status = String(body.shelf_status);
    if (status !== 'on_shelf' && status !== 'off_shelf') {
      return adminJson({ error: 'invalid_shelf_status' }, 400, origin);
    }
    if (status === 'off_shelf') {
      const note = String(body.off_shelf_note ?? '').trim();
      // Same rule as withdrawing a copy at the desk: a removal nobody can
      // explain is a removal nobody can confidently undo.
      if (!note) return adminJson({ error: 'note_required' }, 400, origin);
      patch.shelf_status = 'off_shelf';
      patch.off_shelf_note = note;
      patch.off_shelf_at = new Date().toISOString();
      patch.off_shelf_by = actorEmail;
    } else {
      patch.shelf_status = 'on_shelf';
      patch.off_shelf_note = null;
      patch.off_shelf_at = null;
      patch.off_shelf_by = null;
    }
  }

  if (body.copies_override !== undefined) {
    if (body.copies_override === null) {
      patch.copies_override = null;
    } else {
      const copies = readCopies(body.copies_override);
      // Zero is not a count. A game nobody is bringing goes off the shelf,
      // where it can be seen and put back.
      if (copies === null) return adminJson({ error: 'invalid_copies' }, 400, origin);
      patch.copies_override = copies;
    }
  }

  if (current.source === 'manual') {
    for (const field of ['title', 'year', 'min_players', 'max_players', 'min_time', 'max_time'] as const) {
      if (body[field] === undefined) continue;
      const value = body[field];
      if (field === 'title') {
        const title = String(value ?? '').trim();
        if (!title) return adminJson({ error: 'title_required' }, 400, origin);
        patch.title = title;
      } else {
        patch[field] = value === null || value === '' ? null : Number(value);
      }
    }
    if (body.description !== undefined) {
      patch.description = body.description ? String(body.description).slice(0, 400) : null;
    }
  }

  if (!Object.keys(patch).length) return adminJson({ error: 'nothing_to_update' }, 400, origin);
  patch.updated_at = new Date().toISOString();

  const updated = await sb.from('library_titles').update(patch).eq('id', id).select().single();
  if (updated.error || !updated.data) return adminJson({ error: 'update_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'catalogue.update',
    target_table: 'library_titles',
    target_id: id,
    diff: diffRows(before.data as Record<string, unknown>, updated.data as Record<string, unknown>),
  });
  return adminJson({ ok: true, game: updated.data }, 200, origin);
}

/**
 * POST /api/admin/catalogue/:id/link — { ref, note }
 *
 * Gives an art-less title its BoardGameGeek entry, and fixes the failure this
 * whole mechanism exists for: a club title BGG spells differently becomes a
 * *second card* for a game already on the shelf, with no box art. "Quacks" and
 * "The Quacks of Quedlinburg" are one game and two rows.
 *
 * Two things happen, and both are needed. The alias makes the next harvest
 * reach the same conclusion — `src/data/bgg/*.tsv` is replaced wholesale when a
 * collection is refreshed, so a fix made only to a row comes straight back
 * undone. And if the game is already here under its BGG id, this row's copies
 * move onto that one and this row leaves the shelf, so the count stays right.
 */
export async function handleCatalogueLink(
  req: Request,
  _env: Env,
  sb: SupabaseClient,
  id: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { ref?: string; note?: string } | null;
  const bggId = parseBggRef(String(body?.ref ?? ''));
  if (!bggId) return adminJson({ error: 'invalid_ref' }, 400, origin);

  const before = await sb.from('library_titles').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);
  const current = before.data as unknown as Row;
  if (current.bgg_id) return adminJson({ error: 'already_linked' }, 409, origin);

  let detail: BggDetail;
  try {
    detail = await fetchBggDetail(bggId);
  } catch (error) {
    const message = (error as Error).message;
    return adminJson(
      { error: message === 'bgg_not_found' ? 'bgg_not_found' : 'bgg_unavailable' },
      message === 'bgg_not_found' ? 404 : 502,
      origin,
    );
  }

  const target = await sb
    .from('library_titles')
    .select('id, title')
    .eq('bgg_id', bggId)
    .maybeSingle();

  // The alias is what makes the fix survive the next harvest.
  await sb.from('library_title_aliases').upsert(
    {
      folded_title: foldTitle(current.title),
      bgg_id: bggId,
      note: body?.note ? String(body.note).slice(0, 300) : null,
      created_by: actorEmail,
    },
    { onConflict: 'folded_title' },
  );

  if (target.data) {
    const targetId = (target.data as { id: string; title: string }).id;
    const targetTitle = (target.data as { id: string; title: string }).title;

    // Move the boxes rather than recount them: a copy carries loan history, and
    // `unique (title_id, copy_number)` means they have to be renumbered onto
    // the end of whatever the target already has.
    const mine = await sb.from('library_copies').select('id').eq('title_id', id).order('copy_number');
    const theirs = await sb
      .from('library_copies')
      .select('copy_number')
      .eq('title_id', targetId)
      .order('copy_number', { ascending: false })
      .limit(1);
    let next = ((theirs.data ?? [])[0] as { copy_number: number } | undefined)?.copy_number ?? 0;
    for (const copy of (mine.data ?? []) as { id: string }[]) {
      next += 1;
      await sb.from('library_copies').update({ title_id: targetId, copy_number: next }).eq('id', copy.id);
    }

    const merged = await sb
      .from('library_titles')
      .update({
        shelf_status: 'off_shelf',
        off_shelf_note: `Merged into ${targetTitle} — the same game under a different spelling.`,
        off_shelf_at: new Date().toISOString(),
        off_shelf_by: actorEmail,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (merged.error) return adminJson({ error: 'update_failed' }, 500, origin);

    await writeAudit(sb, {
      actor_email: actorEmail,
      action: 'catalogue.merge',
      target_table: 'library_titles',
      target_id: id,
      diff: { merged_into: targetId, bgg_id: bggId, copies_moved: (mine.data ?? []).length },
    });
    return adminJson({ ok: true, merged_into: targetId, game: merged.data }, 200, origin);
  }

  // Nothing to merge with: this row simply becomes the BGG card. Its `key` is
  // deliberately left alone — the attendee app looks copies up by key, and a
  // rename would strand a bundle that has already shipped.
  const updated = await sb
    .from('library_titles')
    .update({ ...detailColumns(bggId, detail), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (updated.error || !updated.data) return adminJson({ error: 'update_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'catalogue.link',
    target_table: 'library_titles',
    target_id: id,
    diff: diffRows(before.data as Record<string, unknown>, updated.data as Record<string, unknown>),
  });
  return adminJson({ ok: true, game: updated.data }, 200, origin);
}
