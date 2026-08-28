// One-shot migration: move the artwork in `sponsor-logos/` into the database.
//
// The wall used to be that folder alone. Sponsors are now rows an admin
// manages in the console — with a link, a tier and an order — and this script
// carries the existing files across: it uploads each one to the `sponsor-logos`
// bucket and inserts a `sponsors` row for the current edition, named after the
// file, tier `community`, no link (both are what the console is for).
//
// Run it once:
//
//   npx tsx scripts/seed-sponsor-logos.ts            # prints the plan
//   npx tsx scripts/seed-sponsor-logos.ts --apply    # writes
//
// It needs `SUPABASE_SERVICE_KEY` (the same secret the Worker holds) plus
// `PUBLIC_SUPABASE_URL`, from the environment or `.env.local`. The service key
// bypasses RLS, so keep it out of shell history and out of git.
//
// Safe to re-run: a file whose name already matches a sponsor row is skipped,
// so an interrupted run resumes rather than duplicating. Afterwards, add the
// links in the console, delete the migrated files from `sponsor-logos/` in a
// commit, and rebuild the site.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameFromFile, nameKey } from '../src/lib/sponsor-wall.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'sponsor-logos');
const BUCKET = 'sponsor-logos';

/** Mirrors the bucket's `allowed_mime_types`. */
const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** Mirrors the bucket's `file_size_limit`. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Widths tried, in order, for artwork that busts the cap. The wall renders a
 * 480px-wide tile, so even the smallest of these is generous — some of the
 * original files are 3375px square print exports.
 */
const FALLBACK_WIDTHS = [2000, 1400, 1000];

interface Plan {
  file: string;
  name: string;
  bytes: number;
  /** Set when the file had to be downscaled to fit the bucket. */
  resizedFrom?: number;
  body: Buffer;
  contentType: string;
}

/**
 * Read a file, shrinking it if the bucket would refuse it. Re-encoding here
 * rather than asking for new artwork keeps the migration one command, and
 * costs nothing visible: the site re-rasterises every logo to a 480x320 tile.
 */
async function readForUpload(file: string, contentType: string): Promise<{ body: Buffer; original: number }> {
  const original = readFileSync(join(sourceDir, file));
  if (original.byteLength <= MAX_BYTES) return { body: original, original: original.byteLength };
  if (contentType === 'image/svg+xml') {
    throw new Error(`"${file}" is vector and ${(original.byteLength / 1024 / 1024).toFixed(2)} MB; simplify it by hand.`);
  }

  for (const width of FALLBACK_WIDTHS) {
    const pipeline = sharp(original).rotate().resize({ width, withoutEnlargement: true });
    const body = contentType === 'image/jpeg'
      ? await pipeline.jpeg({ quality: 90 }).toBuffer()
      : await pipeline.png({ compressionLevel: 9 }).toBuffer();
    if (body.byteLength <= MAX_BYTES) return { body, original: original.byteLength };
  }
  throw new Error(`"${file}" stays above 2 MB even at ${FALLBACK_WIDTHS.at(-1)}px wide; re-export it by hand.`);
}

async function currentEditionId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from('editions')
    .select('id, slug')
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw new Error(`edition lookup failed: ${error.message}`);
  if (!data) throw new Error('no current edition; set one in the admin console first.');
  console.log(`Seeding into edition ${(data as any).slug} (${(data as any).id}).`);
  return (data as any).id as string;
}

async function existingNames(sb: SupabaseClient, editionId: string): Promise<Set<string>> {
  const { data, error } = await sb.from('sponsors').select('name').eq('edition_id', editionId);
  if (error) throw new Error(`sponsor lookup failed: ${error.message}`);
  return new Set(((data ?? []) as Array<{ name: string }>).map((row) => nameKey(row.name)));
}

async function planUploads(taken: Set<string>): Promise<{ plan: Plan[]; skipped: string[] }> {
  const files = readdirSync(sourceDir)
    .filter((file) => CONTENT_TYPES[extname(file).toLowerCase()])
    .sort((a, b) => nameFromFile(a).localeCompare(nameFromFile(b), 'en', { sensitivity: 'base', numeric: true }));

  const plan: Plan[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const name = nameFromFile(file);
    if (taken.has(nameKey(name))) {
      skipped.push(file);
      continue;
    }
    const contentType = CONTENT_TYPES[extname(file).toLowerCase()];
    const { body, original } = await readForUpload(file, contentType);
    plan.push({
      file,
      name,
      bytes: body.byteLength,
      ...(body.byteLength === original ? {} : { resizedFrom: original }),
      body,
      contentType,
    });
  }
  return { plan, skipped };
}

async function seedOne(sb: SupabaseClient, editionId: string, entry: Plan): Promise<void> {
  const extension = extname(entry.file).toLowerCase().replace('.', '');
  const path = `${editionId}/${crypto.randomUUID()}.${extension}`;

  const uploaded = await sb.storage.from(BUCKET).upload(path, entry.body, {
    contentType: entry.contentType,
    upsert: false,
    cacheControl: '31536000',
  });
  if (uploaded.error) throw new Error(`upload failed for "${entry.file}": ${uploaded.error.message}`);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const inserted = await sb.from('sponsors').insert({
    edition_id: editionId,
    name: entry.name,
    tier: 'community',
    logo_url: data.publicUrl,
    logo_path: path,
    website_url: null,
  });

  // Never leave an object no row points at: it would sit in the bucket
  // unreachable, and a re-run would upload the same artwork again.
  if (inserted.error) {
    await sb.storage.from(BUCKET).remove([path]);
    throw new Error(`insert failed for "${entry.file}": ${inserted.error.message}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { loadEnv } = await import('vite');
  const env = { ...loadEnv('production', repoRoot, ''), ...process.env };
  const url = env.PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_KEY?.trim();
  if (!url) throw new Error('PUBLIC_SUPABASE_URL is not set.');
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_KEY is not set. Export it for this command, or add it to .env.local (gitignored) and remove it afterwards.',
    );
  }

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const editionId = await currentEditionId(sb);
  const { plan, skipped } = await planUploads(await existingNames(sb, editionId));

  if (skipped.length > 0) {
    console.log(`\nAlready in the database, skipping ${skipped.length}: ${skipped.join(', ')}`);
  }
  if (plan.length === 0) {
    console.log('\nNothing left to migrate. Delete the migrated files from sponsor-logos/ and rebuild the site.');
    return;
  }

  const width = Math.max(...plan.map((entry) => entry.file.length));
  console.log(`\n${apply ? 'Migrating' : 'Would migrate'} ${plan.length} logo(s):`);
  plan.forEach((entry, index) => {
    const size = entry.resizedFrom
      ? `${(entry.resizedFrom / 1024 / 1024).toFixed(2)} MB → ${(entry.bytes / 1024).toFixed(0)} kB (downscaled)`
      : `${(entry.bytes / 1024).toFixed(0)} kB`;
    console.log(`  ${String(index).padStart(2)}  ${entry.file.padEnd(width)}  → "${entry.name}"  ${size}`);
  });

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to upload and insert.');
    return;
  }

  for (const entry of plan) {
    await seedOne(sb, editionId, entry);
    console.log(`  ✓ ${entry.file}`);
  }

  console.log(
    `\nMigrated ${plan.length} logo(s). Next: add each sponsor's link on the console's Sponsors page, ` +
      'delete the migrated files from sponsor-logos/ in a commit, then rebuild the site.',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
