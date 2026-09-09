// One-shot: move the committed catalogue into the database.
//
//   SUPABASE_SERVICE_KEY=... npm run migrate:catalogue           # dry run
//   SUPABASE_SERVICE_KEY=... npm run migrate:catalogue -- --apply
//
// Run it once, after applying 20260909120000_library_catalogue.sql and before
// anything reads the table instead of the file. It is idempotent, so a second
// run is safe.
//
// It carries across all three files the catalogue used to live in:
//
//   src/data/game-library.json    the metadata, onto the rows seed:library made
//   src/data/bgc-bgg-ids.tsv      into library_title_aliases
//   src/data/excluded-games.tsv   into shelf_status / copies_override
//
// The exclusion file is the fiddly one, because an excluded game is *absent*
// from the snapshot rather than marked in it — the sync drops it before writing.
// So there is no row to flag, and this creates one, fetching the box from
// BoardGameGeek so the admin list has a name and a picture to show rather than
// a bare id nobody can act on.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from 'vite';
import { fetchBggDetail } from '../worker/src/bgg';
import { titleKey, type LibrarySnapshot } from '../src/lib/game-library';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');

const env = { ...loadEnv('production', root, ''), ...process.env };
const url = env.PUBLIC_SUPABASE_URL?.trim();
const key = env.SUPABASE_SERVICE_KEY?.trim();
if (!url) { console.error('PUBLIC_SUPABASE_URL is not set.'); process.exit(1); }
if (!key) {
  console.error('SUPABASE_SERVICE_KEY is not set. Export it for this command:');
  console.error('  SUPABASE_SERVICE_KEY=... npm run migrate:catalogue -- --apply');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const probe = await sb.from('library_titles').select('shelf_status', { count: 'exact', head: true });
if (probe.error) {
  console.error(`Cannot reach library_titles.shelf_status: ${probe.error.message}`);
  console.error('Apply supabase/migrations/20260909120000_library_catalogue.sql first.');
  process.exit(1);
}

/**
 * The three files this reads are deleted by the same change that adds this
 * script — they are what it exists to replace — so on the merged tree they are
 * only in git history. Reading them from there is what makes this runnable
 * where somebody would actually run it, rather than only from the one commit
 * before the deletion.
 */
function readRetired(path: string): string | null {
  const onDisk = join(root, path);
  if (existsSync(onDisk)) return readFileSync(onDisk, 'utf8');
  for (const rev of ['HEAD', 'HEAD~1', 'origin/main']) {
    try {
      return execFileSync('git', ['show', `${rev}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { /* try the next one */ }
  }
  return null;
}

const snapshotText = readRetired('src/data/game-library.json');
if (!snapshotText) {
  console.error('Cannot find src/data/game-library.json, on disk or in git history.');
  console.error('It was deleted by the change that added this script; run this from a checkout that can see it.');
  process.exit(1);
}
const snapshot = JSON.parse(snapshotText) as LibrarySnapshot;

console.log(`${apply ? 'Applying' : 'Dry run'} — snapshot ${snapshot.generatedAt}, ${snapshot.games.length} games.`);

// --- 1. Metadata onto the rows seed:library already created, matched by key.
const existing = await sb.from('library_titles').select('id, key, bgg_id, title').limit(5000);
if (existing.error) { console.error(existing.error); process.exit(1); }
const rows = (existing.data ?? []) as Array<{ id: string; key: string; bgg_id: number | null; title: string }>;
const idByKey = new Map(rows.map((row) => [row.key, row.id]));

let updated = 0;
let missing = 0;
for (const game of snapshot.games) {
  const id = idByKey.get(game.key);
  if (!id) { missing += 1; continue; }
  updated += 1;
  if (!apply) continue;
  const { error } = await sb
    .from('library_titles')
    .update({
      bgg_id: game.bggId,
      title: game.title,
      year: game.year,
      thumb: game.thumb,
      description: game.description ?? null,
      min_players: game.minPlayers,
      max_players: game.maxPlayers,
      min_time: game.minTime,
      max_time: game.maxTime,
      rating: game.rating,
      weight: game.weight,
      best_with: game.bestWith ?? [],
      // `title-` keys are the BGC club sheet's rows that found no BoardGameGeek
      // match; everything else came from a collection harvest.
      source: game.key.startsWith('title-') ? 'bgc' : 'bgg',
    })
    .eq('id', id);
  if (error) { console.error(`  ${game.key}: ${error.message}`); process.exit(1); }
}
console.log(`  ${updated} rows given their metadata${missing ? `, ${missing} snapshot games had no row` : ''}`);
if (missing) {
  // Every snapshot game should already have a row: seed:library made them, and
  // it ran before this change removed it. A non-zero count means the two have
  // drifted, and sync:library will create the missing rows on its next run.
  console.log('  (those will be created by the next npm run sync:library)');
}

// --- 2. Id overrides become aliases.
const overridesText = readRetired('src/data/bgc-bgg-ids.tsv');
const aliases: Array<{ folded_title: string; bgg_id: number; note: string | null }> = [];
if (overridesText) {
  for (const line of overridesText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [title, id, note] = line.split('\t');
    const bggId = Number(id);
    if (!title?.trim() || !Number.isInteger(bggId) || bggId <= 0) continue;
    aliases.push({ folded_title: titleKey(title), bgg_id: bggId, note: note?.trim() || null });
  }
}
console.log(`  ${aliases.length} title aliases`);
if (apply && aliases.length) {
  const { error } = await sb.from('library_title_aliases').upsert(aliases, { onConflict: 'folded_title' });
  if (error) { console.error(error); process.exit(1); }
}

// --- 3. Exclusions.
const exclusionsText = readRetired('src/data/excluded-games.tsv');
const wholeGame: Array<{ key: string; note: string }> = [];
const scoped: Array<{ bggId: number; note: string }> = [];
if (exclusionsText) {
  for (const line of exclusionsText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [rawKey, , note] = line.split('\t');
    const entry = rawKey?.trim();
    if (!entry) continue;
    // `<bggId>@<collection>` dropped one collection's copy while leaving the
    // card. That form is gone: the same fact is now "the page shows N copies",
    // which is what copies_override says.
    const at = entry.indexOf('@');
    if (at > 0 && /^\d+$/.test(entry.slice(0, at))) {
      scoped.push({ bggId: Number(entry.slice(0, at)), note: note?.trim() || 'a copy is not coming' });
    } else {
      wholeGame.push({ key: entry, note: note?.trim() || 'not coming to the venue' });
    }
  }
}

const byBggId = new Map(rows.filter((row) => row.bgg_id).map((row) => [row.bgg_id as number, row]));
const snapshotCopies = new Map(snapshot.games.map((game) => [game.bggId, game.copies]));

console.log(`  ${wholeGame.length} games off the shelf, ${scoped.length} with a pinned copy count`);

for (const { bggId, note } of scoped) {
  const row = byBggId.get(bggId);
  const copies = snapshotCopies.get(bggId);
  if (!row || !copies) {
    console.log(`    ! ${bggId} is scoped-excluded but not in the snapshot — skipped`);
    continue;
  }
  console.log(`    ${row.title}: pinned at ${copies} ${copies === 1 ? 'copy' : 'copies'} (${note})`);
  if (!apply) continue;
  const { error } = await sb.from('library_titles').update({ copies_override: copies }).eq('id', row.id);
  if (error) { console.error(error); process.exit(1); }
}

for (const { key: entry, note } of wholeGame) {
  const numeric = /^\d+$/.test(entry);
  const bggId = numeric ? Number(entry) : null;
  const found = bggId ? byBggId.get(bggId) : rows.find((row) => titleKey(row.title) === titleKey(entry));

  const offShelf = {
    shelf_status: 'off_shelf',
    off_shelf_note: note,
    off_shelf_at: new Date().toISOString(),
    off_shelf_by: 'migrate-catalogue',
  };

  if (found) {
    console.log(`    ${found.title}: off the shelf (${note})`);
    if (!apply) continue;
    const { error } = await sb.from('library_titles').update(offShelf).eq('id', found.id);
    if (error) { console.error(error); process.exit(1); }
    continue;
  }

  // No row: the sync dropped this game before it ever reached the snapshot, so
  // one has to be made for it to be visible — and put back — in the admin.
  if (!bggId) {
    console.log(`    "${entry}": no row and no BGG id, creating a bare one (${note})`);
    if (!apply) continue;
    const { error } = await sb.from('library_titles').insert({
      key: `title-${titleKey(entry)}`,
      title: entry,
      source: 'bgc',
      ...offShelf,
    });
    if (error && !error.message.includes('duplicate key')) { console.error(error); process.exit(1); }
    continue;
  }

  let name = String(bggId);
  let detail = null as Awaited<ReturnType<typeof fetchBggDetail>> | null;
  try {
    detail = await fetchBggDetail(bggId);
    name = detail.name;
  } catch (error) {
    console.log(`    ! ${bggId}: BGG lookup failed (${(error as Error).message}), creating it unnamed`);
  }
  console.log(`    ${name}: off the shelf, row created (${note})`);
  if (!apply) continue;
  const { error } = await sb.from('library_titles').insert({
    key: `bgg-${bggId}`,
    bgg_id: bggId,
    title: detail?.name || `BGG ${bggId}`,
    year: detail?.year ?? null,
    thumb: detail?.thumb ?? null,
    min_players: detail?.minPlayers ?? null,
    max_players: detail?.maxPlayers ?? null,
    min_time: detail?.minTime ?? null,
    max_time: detail?.maxTime ?? null,
    rating: detail?.rating ?? null,
    weight: detail?.weight ?? null,
    best_with: detail?.bestWith ?? [],
    source: 'bgg',
    ...offShelf,
  });
  if (error && !error.message.includes('duplicate key')) { console.error(error); process.exit(1); }
}

// --- 4. The "where this list comes from" cards, and the snapshot date.
console.log(`  ${snapshot.sources.length} source cards, dated ${snapshot.generatedAt}`);
if (apply) {
  const { error } = await sb
    .from('library_catalogue_meta')
    .upsert({ id: true, sources: snapshot.sources, synced_at: `${snapshot.generatedAt}T00:00:00Z` });
  if (error) { console.error(error); process.exit(1); }
}

console.log(apply ? '\nDone.' : '\nDry run only. Re-run with --apply to write.');
