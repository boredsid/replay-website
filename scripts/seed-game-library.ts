// Loads the committed catalogue snapshot into `library_titles` / `library_copies`.
//
// `src/data/game-library.json` stays the source of truth for what a game *is* —
// it is rebuilt by `npm run sync:library` from the BGC library and four
// BoardGameGeek collections, and committed. These tables exist for the thing a
// JSON file cannot do: know where a physical box currently is.
//
// Run with `npm run seed:library`. Idempotent — safe to re-run after a
// `sync:library` refresh, and it never removes a copy that has ever been
// loaned, because a loan referencing a vanished copy is worse than an extra
// row on a shelf.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same convention as seed-sponsor-logos.ts: the service key is exported for the
// command, never written to a file.
const env = { ...loadEnv('production', root, ''), ...process.env };
const url = env.PUBLIC_SUPABASE_URL?.trim();
const key = env.SUPABASE_SERVICE_KEY?.trim();
if (!url) { console.error('PUBLIC_SUPABASE_URL is not set.'); process.exit(1); }
if (!key) {
  console.error('SUPABASE_SERVICE_KEY is not set. Export it for this command:');
  console.error('  SUPABASE_SERVICE_KEY=... npm run seed:library');
  process.exit(1);
}
/**
 * Says what is wrong with a key without ever printing it.
 *
 * "Invalid API key" from PostgREST is almost always one of two things: the
 * anon key pasted where service_role was wanted, or a key from a different
 * project. Both are invisible by eye, and neither is worth debugging by
 * pasting a secret into a terminal someone is watching.
 */
function describeKey(value: string, projectUrl: string): string {
  const ref = projectUrl.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] ?? '(unknown)';
  if (value.startsWith('sb_secret_')) return `new-style secret key, project ${ref}`;
  if (value.startsWith('sb_publishable_')) {
    return `PUBLISHABLE key -- that is the public one. You need the secret key. Project ${ref}`;
  }
  const parts = value.split('.');
  if (parts.length !== 3) return `unrecognised key format (${value.length} chars), project ${ref}`;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { role?: string; ref?: string };
    const mismatch = claims.ref && claims.ref !== ref ? `  <-- belongs to "${claims.ref}", not "${ref}"` : '';
    return `role="${claims.role}", project "${claims.ref}"${mismatch}`;
  } catch {
    return `a JWT that would not decode, project ${ref}`;
  }
}

console.log(`Key: ${describeKey(key, url)}`);

const sb = createClient(url, key, { auth: { persistSession: false } });

// Fail early and legibly rather than partway through the first write.
const probe = await sb.from('library_titles').select('id', { count: 'exact', head: true });
if (probe.error) {
  console.error(`\nCannot reach library_titles: ${probe.error.message}`);
  console.error('If the key line above does not say role="service_role" or "new-style secret key",');
  console.error('that is the problem: the anon/publishable key has no grants on these tables.');
  process.exit(1);
}

interface SnapshotGame {
  key: string;
  bggId: number | null;
  title: string;
  year: number | null;
  thumb: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  minTime: number | null;
  maxTime: number | null;
  rating: number | null;
  weight: number | null;
  bestWith: number[] | null;
  copies: number;
}

const snapshot = JSON.parse(
  readFileSync(join(root, 'src/data/game-library.json'), 'utf8'),
) as { generatedAt: string; games: SnapshotGame[] };

const games = snapshot.games;
const copyTotal = games.reduce((sum, g) => sum + (Number(g.copies) || 0), 0);
console.log(`Snapshot ${snapshot.generatedAt}: ${games.length} titles, ${copyTotal} copies.`);

// Only what circulation needs. The snapshot keeps rating, weight, player
// counts and artwork -- duplicating them here would create a second source of
// truth that drifts apart on the next `sync:library`.
const titleRows = games.map((g) => ({
  key: g.key,
  bgg_id: g.bggId ?? null,
  title: g.title,
}));

// Chunked because PostgREST will not take 586 rows in one body comfortably, and
// a partial failure is easier to reason about in hundreds than in one blob.
const CHUNK = 200;
for (let i = 0; i < titleRows.length; i += CHUNK) {
  const slice = titleRows.slice(i, i + CHUNK);
  const { error } = await sb.from('library_titles').upsert(slice, { onConflict: 'key' });
  if (error) { console.error('titles failed', error); process.exit(1); }
  console.log(`  titles ${Math.min(i + CHUNK, titleRows.length)}/${titleRows.length}`);
}

const { data: stored, error: readError } = await sb
  .from('library_titles')
  .select('id, key')
  .limit(2000);
if (readError) { console.error(readError); process.exit(1); }
const idByKey = new Map((stored ?? []).map((row) => [row.key as string, row.id as string]));

const { data: existing, error: copyReadError } = await sb
  .from('library_copies')
  .select('title_id, copy_number')
  .limit(5000);
if (copyReadError) { console.error(copyReadError); process.exit(1); }
const have = new Set((existing ?? []).map((c) => `${c.title_id}:${c.copy_number}`));

const copyRows: Array<{ title_id: string; copy_number: number }> = [];
for (const game of games) {
  const titleId = idByKey.get(game.key);
  if (!titleId) { console.warn(`  no row for ${game.key}, skipped`); continue; }
  for (let n = 1; n <= (Number(game.copies) || 0); n += 1) {
    if (!have.has(`${titleId}:${n}`)) copyRows.push({ title_id: titleId, copy_number: n });
  }
}

console.log(`${copyRows.length} copies to add (${have.size} already present).`);
for (let i = 0; i < copyRows.length; i += CHUNK) {
  const slice = copyRows.slice(i, i + CHUNK);
  const { error } = await sb.from('library_copies').insert(slice);
  if (error) { console.error('copies failed', error); process.exit(1); }
  console.log(`  copies ${Math.min(i + CHUNK, copyRows.length)}/${copyRows.length}`);
}

// A snapshot that lost a copy leaves the extra row alone on purpose: it may
// have a loan history hanging off it, and withdrawing is the deliberate way to
// take something out of circulation.
const { count: titleCount } = await sb.from('library_titles').select('*', { count: 'exact', head: true });
const { count: copyCount } = await sb.from('library_copies').select('*', { count: 'exact', head: true });
console.log(`Done: ${titleCount} titles, ${copyCount} copies in the database.`);
