// Build-time normaliser for the homepage partner/sponsor logo wall.
//
// Reads every logo in `sponsor-logos/`, works out where the mark actually is
// (see src/lib/logo-normalize.ts for the judgement), and writes a normalised
// PNG per logo into `src/generated/sponsor-logos/`. Astro globs that generated
// folder, so the wall receives ten identically-framed tiles instead of ten
// arbitrary canvases.
//
// Runs automatically via the `prebuild`/`predev` npm lifecycle hooks. Output is
// gitignored and regenerated from source every time.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_OPTIONS, planNormalization, type NormalizePlan } from '../src/lib/logo-normalize.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'sponsor-logos');
const outputDir = join(repoRoot, 'src/generated/sponsor-logos');

const SUPPORTED = new Set(['.avif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

/** SVGs are vector; rasterise well above the 480px canvas so downscaling is clean. */
const SVG_DENSITY = 300;

interface Result {
  source: string;
  output: string;
  plan: NormalizePlan;
  sourceSize: string;
  bytes: number;
}

async function normalizeOne(filename: string): Promise<Result> {
  const path = join(sourceDir, filename);
  const isSvg = extname(filename).toLowerCase() === '.svg';
  const input = sharp(path, isSvg ? { density: SVG_DENSITY } : {});

  // `.rotate()` with no argument applies EXIF orientation. Without it a
  // phone-camera JPEG is measured in the wrong orientation and cropped wrong.
  const oriented = input.rotate();
  const { data, info } = await oriented.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plan = planNormalization({ data, width: info.width, height: info.height });

  const { crop, placement, canvas, canvasBackground } = plan;
  const background = canvasBackground
    ? { r: canvasBackground[0], g: canvasBackground[1], b: canvasBackground[2], alpha: 1 }
    : { r: 0, g: 0, b: 0, alpha: 0 };

  let pipeline = sharp(path, isSvg ? { density: SVG_DENSITY } : {}).rotate().ensureAlpha();
  const isWholeImage = crop.width === info.width && crop.height === info.height;
  if (!isWholeImage) pipeline = pipeline.extract(crop);

  const buffer = await pipeline
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

  const output = `${filename.slice(0, filename.length - extname(filename).length)}.png`;
  writeFileSync(join(outputDir, output), buffer);

  return { source: filename, output, plan, sourceSize: `${info.width}x${info.height}`, bytes: buffer.length };
}

async function main(): Promise<void> {
  let sources: string[];
  try {
    sources = readdirSync(sourceDir)
      .filter((name) => SUPPORTED.has(extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }));
  } catch {
    console.warn(`[sponsor-logos] no ${sourceDir} directory; nothing to normalise.`);
    return;
  }

  // Two sources differing only by extension would race for one output name.
  const claimed = new Map<string, string>();
  for (const name of sources) {
    const key = name.slice(0, name.length - extname(name).length).toLowerCase();
    const existing = claimed.get(key);
    if (existing) {
      throw new Error(`[sponsor-logos] "${existing}" and "${name}" normalise to the same filename. Rename one.`);
    }
    claimed.set(key, name);
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  if (sources.length === 0) {
    console.warn('[sponsor-logos] no logos found; the wall will be empty.');
    return;
  }

  const results: Result[] = [];
  for (const name of sources) {
    try {
      results.push(await normalizeOne(name));
    } catch (error) {
      throw new Error(`[sponsor-logos] failed on "${name}": ${(error as Error).message}`);
    }
  }

  const width = Math.max(...results.map((r) => r.source.length));
  console.log(`[sponsor-logos] normalised ${results.length} logo(s) to ${DEFAULT_OPTIONS.canvasWidth}x${DEFAULT_OPTIONS.canvasHeight}:`);
  for (const r of results) {
    const mark = `${r.plan.placement.width}x${r.plan.placement.height}`;
    const flags = r.plan.belowTargetSize ? '  ⚠ below target size' : '';
    console.log(
      `  ${r.source.padEnd(width)}  ${r.sourceSize.padStart(11)} → mark ${mark.padStart(9)}` +
        `  ${r.plan.background.kind.padEnd(11)} ${r.plan.decision}${flags}`,
    );
  }

  const undersized = results.filter((r) => r.plan.belowTargetSize);
  if (undersized.length > 0) {
    console.warn(
      `[sponsor-logos] ${undersized.length} logo(s) are smaller than the target box and were not upscaled: ` +
        `${undersized.map((r) => r.source).join(', ')}. Supply artwork at least ` +
        `${DEFAULT_OPTIONS.canvasWidth}px wide so they match the rest of the wall.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
