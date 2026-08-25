// Build-time renderer for the social link-preview card (`/link-preview.png`).
//
// Called from the `src/pages/link-preview.png.ts` endpoint, which Astro
// evaluates once per build and writes straight to `dist/link-preview.png`.
// That is why the card never goes stale: the same admin "Rebuild site" action
// that republishes edition dates on the pages also re-renders this image, so
// there is no per-edition artwork to hand-export.
//
// The copy decisions live in `src/lib/link-preview.ts` and are unit-tested on
// their own. This file only knows about pixels — and about `sharp`, which is a
// native module and must stay out of the Worker.
import { join } from 'node:path';
import sharp from 'sharp';
import type { LinkPreviewContent, LinkPreviewField } from '../src/lib/link-preview.ts';

// Resolved from the working directory, not `import.meta.url`: Vite bundles this
// module into `dist/.prerender/chunks/`, so a module-relative path lands inside
// the build output instead of the repo. Astro's own `public/` handling makes the
// same assumption — the build runs from the project root.
const repoRoot = process.cwd();
const WORDMARK = join(repoRoot, 'public/replay-logo.png');
const FONT_BOLD = join(repoRoot, 'scripts/fonts/SpaceGrotesk-Bold.ttf');
const FONT_MEDIUM = join(repoRoot, 'scripts/fonts/SpaceGrotesk-Medium.ttf');

/** 1.91:1, the size Open Graph, Twitter, WhatsApp, and Slack all crop to. */
const WIDTH = 1200;
const HEIGHT = 630;

const BLUE = '#283891';
const CREAM = '#FFF8E7';
const ORANGE = '#F47B20';
/** Cream at ~62% over the blue — a note line, not a heading. */
const MUTED = '#9AA3CE';

/** The wordmark is 1640x373 artwork; 620px wide leaves generous side margins. */
const WORDMARK_WIDTH = 620;
const WORDMARK_TOP = 92;

/** Pango wants letter spacing in 1024ths of a point. */
const em = (points: number) => Math.round(points * 1024);

function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface TextOptions {
  size: number;
  color: string;
  bold?: boolean;
  tracking?: number;
}

async function renderText(text: string, options: TextOptions) {
  const { size, color, bold = false, tracking = 0 } = options;
  const spacing = tracking ? ` letter_spacing="${em(tracking)}"` : '';
  const buffer = await sharp({
    text: {
      text: `<span foreground="${color}"${spacing}>${escapeMarkup(text)}</span>`,
      font: bold ? `Space Grotesk Bold ${size}` : `Space Grotesk Medium ${size}`,
      fontfile: bold ? FONT_BOLD : FONT_MEDIUM,
      rgba: true,
      dpi: 96,
    },
  })
    .png()
    .toBuffer();
  const { width = 0, height = 0 } = await sharp(buffer).metadata();
  return { buffer, width, height };
}

type Layer = { input: Buffer; left: number; top: number };

/** Centre a rendered run on `centerX` and return the baseline for the next one. */
async function centered(
  layers: Layer[],
  text: string,
  centerX: number,
  top: number,
  options: TextOptions & { gap?: number },
): Promise<number> {
  const run = await renderText(text, options);
  layers.push({ input: run.buffer, left: Math.round(centerX - run.width / 2), top: Math.round(top) });
  return top + run.height + (options.gap ?? 0);
}

/** Each column owns just under half the card; the value type shrinks to fit it. */
const FIELD_MAX_WIDTH = 460;
const VALUE_SIZES = [44, 39, 34, 30];

/**
 * Pick the largest value size whose widest line still fits the column. Venue
 * names are staff-entered free text, so "it fits today" is not a guarantee.
 */
async function fitValueSize(lines: string[]): Promise<number> {
  for (const size of VALUE_SIZES) {
    const widths = await Promise.all(
      lines.map(async (line) => (await renderText(line, { size, color: CREAM, bold: true })).width),
    );
    if (Math.max(...widths) <= FIELD_MAX_WIDTH) return size;
  }
  return VALUE_SIZES[VALUE_SIZES.length - 1];
}

/** A WHEN/WHERE column: small tracked label, big value lines, muted note. */
async function renderField(layers: Layer[], field: LinkPreviewField, centerX: number, top: number): Promise<void> {
  let y = await centered(layers, field.label, centerX, top, {
    size: 19,
    color: MUTED,
    tracking: 3,
    gap: 18,
  });
  const size = await fitValueSize(field.value);
  for (const line of field.value) {
    y = await centered(layers, line, centerX, y, { size, color: CREAM, bold: true, gap: 6 });
  }
  if (field.note) {
    await centered(layers, field.note, centerX, y + 8, { size: 24, color: MUTED, tracking: 1.5 });
  }
}

export async function renderLinkPreview(content: LinkPreviewContent): Promise<Buffer> {
  const layers: Layer[] = [];
  const midX = WIDTH / 2;
  const hasFields = Boolean(content.when || content.where);
  // With no edition to name there is no bottom half to balance against, so the
  // wordmark drops to the middle of the card instead of leaving a void below.
  const wordmarkTop = hasFields ? WORDMARK_TOP : WORDMARK_TOP + 100;

  if (content.eyebrow) {
    await centered(layers, content.eyebrow, midX, 44, { size: 21, color: ORANGE, bold: true, tracking: 5 });
  }

  const wordmark = await sharp(WORDMARK).resize({ width: WORDMARK_WIDTH }).png().toBuffer();
  const wordmarkHeight = (await sharp(wordmark).metadata()).height ?? 0;
  layers.push({ input: wordmark, left: Math.round(midX - WORDMARK_WIDTH / 2), top: wordmarkTop });

  await centered(layers, content.tagline, midX, wordmarkTop + wordmarkHeight + 30, {
    size: 33,
    color: CREAM,
  });

  // The two columns sit on a shared top edge, each centred in its half of the
  // card, so a two-line venue name grows downward without shoving WHEN around.
  const fieldsTop = 414;
  if (content.when) await renderField(layers, content.when, WIDTH * 0.28, fieldsTop);
  if (content.where) await renderField(layers, content.where, WIDTH * 0.72, fieldsTop);

  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: BLUE } })
    .composite(layers)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}
