// src/lib/logo-normalize.ts
//
// Geometry and background decisions for the partner/sponsor logo wall.
//
// Sponsor logos arrive from whoever designed them: square canvases with the
// mark floating in the middle, wordmarks 8x wider than they are tall, PNGs on
// transparency, JPEGs on a white matte, and marks whose own background is a
// solid dark block. Left alone they render at wildly different optical sizes
// because the wall can only scale the *canvas* it is handed, not the mark
// inside it.
//
// This module decides, from raw pixels alone, what is background and where the
// mark actually is. It has no image-codec dependency: `scripts/normalize-
// sponsor-logos.ts` supplies decoded pixels via sharp and executes the plan.
// Keeping the judgement here means it can be unit-tested against synthetic
// images instead of fixtures.

export interface RgbaImage {
  /** Row-major RGBA, 4 bytes per pixel. */
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Rgb = readonly [number, number, number];

export type Background =
  /** Border ring is almost entirely alpha-0. Safe to trim. */
  | { kind: 'transparent' }
  /** Border ring is a uniform near-white matte. Safe to trim. */
  | { kind: 'light'; color: Rgb }
  /** Border ring is uniform but dark or saturated — probably part of the mark. */
  | { kind: 'opaque'; color: Rgb }
  /** Border ring is not uniform — the mark bleeds to the edge. */
  | { kind: 'busy' };

export type TrimDecision =
  | 'trimmed'
  | 'already-tight'
  | 'kept-opaque-background'
  | 'kept-busy-background'
  | 'kept-trim-too-aggressive'
  | 'kept-blank-image';

export interface NormalizeOptions {
  /** Output canvas. 3:2 matches the wall's cell, so cells crop nothing. */
  canvasWidth: number;
  canvasHeight: number;
  /** Share of each edge left empty, so no mark touches the cell border. */
  paddingRatio: number;
  /** Alpha at or below this counts as fully transparent. */
  alphaFloor: number;
  /** Share of border samples that must be transparent to call it transparent. */
  transparentRatio: number;
  /** Max per-channel deviation across the border ring still considered uniform. */
  uniformSpread: number;
  /** Rec. 709 luma at or above which a uniform matte is safe to strip. */
  lightLuma: number;
  /** Per-channel tolerance when testing a pixel against the matte colour. */
  trimTolerance: number;
  /** Reject a trim retaining less than this share of either dimension. */
  minRetainedSide: number;
}

export const DEFAULT_OPTIONS: NormalizeOptions = {
  canvasWidth: 480,
  canvasHeight: 320,
  paddingRatio: 0.1,
  alphaFloor: 8,
  transparentRatio: 0.9,
  uniformSpread: 18,
  lightLuma: 232,
  trimTolerance: 12,
  minRetainedSide: 0.05,
};

function channelAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

function luma([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Classify the background by sampling the one-pixel border ring.
 *
 * The ring is the only region we can assume is background without already
 * knowing where the mark is. A logo that genuinely bleeds to all four edges
 * reads as `busy` and is left alone, which is the correct outcome.
 */
export function detectBackground(image: RgbaImage, options: NormalizeOptions = DEFAULT_OPTIONS): Background {
  const { width, height } = image;
  if (width === 0 || height === 0) return { kind: 'busy' };

  // Sub-sample large borders; a 3375px edge does not need 3375 reads.
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  const ring: Array<[number, number, number, number]> = [];
  for (let x = 0; x < width; x += step) {
    ring.push(channelAt(image, x, 0));
    ring.push(channelAt(image, x, height - 1));
  }
  for (let y = 0; y < height; y += step) {
    ring.push(channelAt(image, 0, y));
    ring.push(channelAt(image, width - 1, y));
  }

  const transparent = ring.filter((p) => p[3] <= options.alphaFloor).length;
  if (transparent / ring.length >= options.transparentRatio) return { kind: 'transparent' };

  const opaque = ring.filter((p) => p[3] > options.alphaFloor);
  if (opaque.length === 0) return { kind: 'transparent' };

  const mean: Rgb = [0, 1, 2].map((c) => opaque.reduce((sum, p) => sum + p[c], 0) / opaque.length) as unknown as Rgb;
  const spread = Math.max(
    ...opaque.map((p) => Math.max(Math.abs(p[0] - mean[0]), Math.abs(p[1] - mean[1]), Math.abs(p[2] - mean[2]))),
  );
  if (spread > options.uniformSpread) return { kind: 'busy' };

  const color: Rgb = [Math.round(mean[0]), Math.round(mean[1]), Math.round(mean[2])];
  // A uniform *dark* border is far more likely to be a deliberate block the
  // mark sits inside (a black badge, a coloured tile) than padding to strip.
  // Getting this wrong deletes the entire logo, so only near-white is trimmed.
  return luma(color) >= options.lightLuma ? { kind: 'light', color } : { kind: 'opaque', color };
}

/** Tightest box containing everything that is not background. */
export function contentBox(
  image: RgbaImage,
  background: Background,
  options: NormalizeOptions = DEFAULT_OPTIONS,
): Box | null {
  const { width, height } = image;
  if (width === 0 || height === 0) return null;

  const matte = background.kind === 'light' || background.kind === 'opaque' ? background.color : null;
  const isBackground = (x: number, y: number): boolean => {
    const [r, g, b, a] = channelAt(image, x, y);
    if (a <= options.alphaFloor) return true;
    if (!matte) return false;
    return (
      Math.abs(r - matte[0]) <= options.trimTolerance &&
      Math.abs(g - matte[1]) <= options.trimTolerance &&
      Math.abs(b - matte[2]) <= options.trimTolerance
    );
  };

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;

  const rowIsBackground = (y: number): boolean => {
    for (let x = 0; x < width; x++) if (!isBackground(x, y)) return false;
    return true;
  };
  const columnIsBackground = (x: number): boolean => {
    for (let y = top; y <= bottom; y++) if (!isBackground(x, y)) return false;
    return true;
  };

  while (top <= bottom && rowIsBackground(top)) top++;
  if (top > bottom) return null; // Entirely background.
  while (bottom > top && rowIsBackground(bottom)) bottom--;
  while (left <= right && columnIsBackground(left)) left++;
  if (left > right) return null;
  while (right > left && columnIsBackground(right)) right--;

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export interface NormalizePlan {
  background: Background;
  decision: TrimDecision;
  /** Region of the source to keep. Whole image when nothing was trimmed. */
  crop: Box;
  canvas: { width: number; height: number };
  /** Where the resized crop is composited onto the canvas. */
  placement: Box;
  /** Canvas fill behind the mark. `null` means leave it transparent. */
  canvasBackground: Rgb | null;
  /**
   * Source is smaller than the target box, so the mark renders below the
   * common size. We never upscale — inventing pixels trades a small logo for
   * a blurry one — so this is surfaced instead of silently corrected.
   */
  belowTargetSize: boolean;
}

/** Decide the crop, scale and placement for one logo. Pure geometry. */
export function planNormalization(image: RgbaImage, options: NormalizeOptions = DEFAULT_OPTIONS): NormalizePlan {
  const whole: Box = { left: 0, top: 0, width: image.width, height: image.height };
  const background = detectBackground(image, options);

  let crop = whole;
  let decision: TrimDecision;

  if (background.kind === 'opaque') {
    decision = 'kept-opaque-background';
  } else if (background.kind === 'busy') {
    decision = 'kept-busy-background';
  } else {
    const box = contentBox(image, background, options);
    if (!box) {
      decision = 'kept-blank-image';
    } else if (
      box.width < image.width * options.minRetainedSide ||
      box.height < image.height * options.minRetainedSide
    ) {
      // Retaining a sliver means the background read was wrong, not that the
      // logo is a sliver. Keep the original rather than ship a destroyed mark.
      decision = 'kept-trim-too-aggressive';
    } else if (box.width === image.width && box.height === image.height) {
      decision = 'already-tight';
    } else {
      crop = box;
      decision = 'trimmed';
    }
  }

  const { canvasWidth, canvasHeight, paddingRatio } = options;
  const innerWidth = Math.round(canvasWidth * (1 - paddingRatio * 2));
  const innerHeight = Math.round(canvasHeight * (1 - paddingRatio * 2));
  const scale = Math.min(innerWidth / crop.width, innerHeight / crop.height, 1);
  const markWidth = Math.max(1, Math.round(crop.width * scale));
  const markHeight = Math.max(1, Math.round(crop.height * scale));

  return {
    background,
    decision,
    crop,
    canvas: { width: canvasWidth, height: canvasHeight },
    placement: {
      left: Math.floor((canvasWidth - markWidth) / 2),
      top: Math.floor((canvasHeight - markHeight) / 2),
      width: markWidth,
      height: markHeight,
    },
    // A stripped white matte is re-laid across the whole tile so the trimmed
    // block and its padding stay seamless. An untrimmed opaque mark keeps
    // transparent padding — extending its own dark colour would turn a small
    // badge into a full-bleed dark tile.
    canvasBackground: background.kind === 'light' ? background.color : null,
    belowTargetSize: crop.width < innerWidth && crop.height < innerHeight,
  };
}
