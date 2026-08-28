// Build-time normaliser for the homepage partner/sponsor logo wall.
//
// Collects every logo the wall should show — `sponsors` rows for the current
// edition, uploaded through the admin console, plus any legacy artwork still
// sitting in `sponsor-logos/` — works out where each mark actually is (see
// src/lib/logo-normalize.ts for the judgement), and writes a normalised PNG per
// logo into `src/generated/sponsor-logos/`, alongside a `manifest.json` naming
// each tile and the link it carries. Astro reads that folder, so the wall
// receives identically-framed tiles instead of arbitrary canvases.
//
// Triggered from the `sponsorLogos()` integration in astro.config.mjs on
// `astro:config:setup`, so it runs for both `astro dev` and `astro build` no
// matter which command the host invokes — Cloudflare Pages running a bare
// `astro build` would skip an npm lifecycle hook, and the resulting fallback
// to un-normalised artwork is silent. Also runnable directly via
// `npm run normalize:logos`. Output is gitignored and rebuilt from source
// every time.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_OPTIONS, planNormalization, type NormalizePlan } from '../src/lib/logo-normalize.ts';
import { buildWall, type SponsorWallRow, type WallEntry } from '../src/lib/sponsor-wall.ts';
import { restUrl } from '../src/lib/supabase-rest.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'sponsor-logos');
const outputDir = join(repoRoot, 'src/generated/sponsor-logos');

const SUPPORTED = new Set(['.avif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

/** SVGs are vector; rasterise well above the 480px canvas so downscaling is clean. */
const SVG_DENSITY = 300;

export interface NormalizeSources {
  /** Anonymous Supabase credentials; without them only local artwork is used. */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

/** One line per tile, read by `src/lib/partner-logos.ts`. */
export interface ManifestEntry {
  file: string;
  name: string;
  href: string | null;
}

interface Result {
  label: string;
  output: string;
  plan: NormalizePlan;
  sourceSize: string;
}

async function supabaseSelect(
  { supabaseUrl, supabaseAnonKey }: Required<NormalizeSources>,
  path: string,
): Promise<any[]> {
  const key = supabaseAnonKey.trim();
  const response = await fetch(restUrl(supabaseUrl, path), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`supabase read failed (${response.status}) for ${path}`);
  }
  return await response.json() as any[];
}

/**
 * Sponsors for the published, current edition. RLS allows this read with the
 * anon key — the same key and the same rows the rest of the site builds from.
 *
 * A configured project that then fails to answer throws: the usual reason to
 * rebuild is a sponsor change, and a wall that silently loses a paying
 * sponsor's logo is worse than a build that stops.
 */
async function fetchSponsorRows(sources: NormalizeSources): Promise<SponsorWallRow[]> {
  const { supabaseUrl, supabaseAnonKey } = sources;
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder')) {
    console.warn('[sponsor-logos] no Supabase credentials; using only the artwork in sponsor-logos/.');
    return [];
  }

  const credentials = { supabaseUrl, supabaseAnonKey };
  const editions = await supabaseSelect(credentials, 'editions?select=id&is_current=eq.true&is_published=eq.true');
  const editionId = editions[0]?.id;
  if (!editionId) {
    console.warn('[sponsor-logos] no published current edition; using only the artwork in sponsor-logos/.');
    return [];
  }

  return await supabaseSelect(
    credentials,
    `sponsors?select=id,name,tier,logo_url,website_url&edition_id=eq.${encodeURIComponent(editionId)}`,
  ) as SponsorWallRow[];
}

function localLogoFiles(): string[] {
  let files: string[];
  try {
    files = readdirSync(sourceDir).filter((name) => SUPPORTED.has(extname(name).toLowerCase()));
  } catch {
    console.warn(`[sponsor-logos] no ${sourceDir} directory.`);
    return [];
  }

  // Two sources differing only by extension would race for one output name.
  const claimed = new Map<string, string>();
  for (const name of files) {
    const key = name.slice(0, name.length - extname(name).length).toLowerCase();
    const existing = claimed.get(key);
    if (existing) {
      throw new Error(`[sponsor-logos] "${existing}" and "${name}" normalise to the same filename. Rename one.`);
    }
    claimed.set(key, name);
  }
  return files;
}

async function readEntry(entry: WallEntry): Promise<{ buffer: Buffer; isSvg: boolean; label: string }> {
  if (entry.source.kind === 'local') {
    const file = entry.source.file;
    return {
      buffer: readFileSync(join(sourceDir, file)),
      isSvg: extname(file).toLowerCase() === '.svg',
      label: file,
    };
  }

  const response = await fetch(entry.source.url);
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    isSvg: contentType.includes('svg') || new URL(entry.source.url).pathname.toLowerCase().endsWith('.svg'),
    label: `${entry.name} (uploaded)`,
  };
}

async function normalizeOne(entry: WallEntry): Promise<Result> {
  const { buffer, isSvg, label } = await readEntry(entry);
  const options = isSvg ? { density: SVG_DENSITY } : {};

  // `.rotate()` with no argument applies EXIF orientation. Without it a
  // phone-camera JPEG is measured in the wrong orientation and cropped wrong.
  const oriented = sharp(buffer, options).rotate();
  const { data, info } = await oriented.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plan = planNormalization({ data, width: info.width, height: info.height });

  const { crop, placement, canvas, canvasBackground } = plan;
  const background = canvasBackground
    ? { r: canvasBackground[0], g: canvasBackground[1], b: canvasBackground[2], alpha: 1 }
    : { r: 0, g: 0, b: 0, alpha: 0 };

  let pipeline = sharp(buffer, options).rotate().ensureAlpha();
  const isWholeImage = crop.width === info.width && crop.height === info.height;
  if (!isWholeImage) pipeline = pipeline.extract(crop);

  const output = `${entry.key}.png`;
  const rendered = await pipeline
    .resize(placement.width, placement.height, { fit: 'fill' })
    .extend({
      left: placement.left,
      top: placement.top,
      right: canvas.width - placement.width - placement.left,
      bottom: canvas.height - placement.height - placement.top,
      background,
    })
    // Lossless: Astro re-encodes these to webp at its own quality setting, and
    // stacking two lossy passes softens fine wordmarks for no benefit.
    .png({ compressionLevel: 9 })
    .toBuffer();

  writeFileSync(join(outputDir, output), rendered);

  return { label, output, plan, sourceSize: `${info.width}x${info.height}` };
}

export async function normalizeSponsorLogos(sources: NormalizeSources = {}): Promise<void> {
  const rows = await fetchSponsorRows(sources);
  const wall = buildWall(rows, localLogoFiles());

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'manifest.json'), '[]');

  if (wall.length === 0) {
    console.warn('[sponsor-logos] no logos found; the wall will be empty.');
    return;
  }

  const results: Result[] = [];
  const manifest: ManifestEntry[] = [];
  for (const entry of wall) {
    try {
      const result = await normalizeOne(entry);
      results.push(result);
      manifest.push({ file: result.output, name: entry.name, href: entry.href });
    } catch (error) {
      const where = entry.source.kind === 'local' ? entry.source.file : entry.source.url;
      throw new Error(`[sponsor-logos] failed on "${entry.name}" (${where}): ${(error as Error).message}`);
    }
  }

  writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const uploaded = wall.filter((entry) => entry.source.kind === 'remote').length;
  const linked = manifest.filter((entry) => entry.href).length;
  const width = Math.max(...results.map((r) => r.label.length));
  console.log(
    `[sponsor-logos] normalised ${results.length} logo(s) to ${DEFAULT_OPTIONS.canvasWidth}x${DEFAULT_OPTIONS.canvasHeight} ` +
      `(${uploaded} uploaded, ${results.length - uploaded} from sponsor-logos/, ${linked} clickable):`,
  );
  for (const r of results) {
    const mark = `${r.plan.placement.width}x${r.plan.placement.height}`;
    const flags = r.plan.belowTargetSize ? '  ⚠ below target size' : '';
    console.log(
      `  ${r.label.padEnd(width)}  ${r.sourceSize.padStart(11)} → mark ${mark.padStart(9)}` +
        `  ${r.plan.background.kind.padEnd(11)} ${r.plan.decision}${flags}`,
    );
  }

  const undersized = results.filter((r) => r.plan.belowTargetSize);
  if (undersized.length > 0) {
    console.warn(
      `[sponsor-logos] ${undersized.length} logo(s) are smaller than the target box and were not upscaled: ` +
        `${undersized.map((r) => r.label).join(', ')}. Supply artwork at least ` +
        `${DEFAULT_OPTIONS.canvasWidth}px wide so they match the rest of the wall.`,
    );
  }
}

// Direct invocation (`npm run normalize:logos`) only; importing this module
// from the Astro config must not kick off a run as a side effect.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // Astro hands the integration credentials it loaded itself; a direct run has
  // to find `.env.local` the same way Vite would.
  const { loadEnv } = await import('vite');
  const env = { ...loadEnv('production', repoRoot, ''), ...process.env };
  normalizeSponsorLogos({
    supabaseUrl: env.PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
