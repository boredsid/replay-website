import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTIONS,
  contentBox,
  detectBackground,
  dilateAlpha,
  haloRadius,
  paintHalo,
  planNormalization,
  type RgbaImage,
} from './logo-normalize';

type Pixel = [number, number, number, number];

const TRANSPARENT: Pixel = [0, 0, 0, 0];
const WHITE: Pixel = [255, 255, 255, 255];
const BLACK: Pixel = [0, 0, 0, 255];
const ORANGE: Pixel = [232, 106, 51, 255];

/** Build an image from a fill, then paint a rectangle of `mark` onto it. */
function image(
  width: number,
  height: number,
  fill: Pixel,
  ...marks: Array<{ box: { left: number; top: number; width: number; height: number }; color: Pixel }>
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  for (const mark of marks) {
    for (let y = mark.box.top; y < mark.box.top + mark.box.height; y++) {
      for (let x = mark.box.left; x < mark.box.left + mark.box.width; x++) {
        data.set(mark.color, (y * width + x) * 4);
      }
    }
  }
  return { data, width, height };
}

describe('detectBackground', () => {
  it('reads an alpha-0 border as transparent', () => {
    const png = image(100, 100, TRANSPARENT, { box: { left: 30, top: 40, width: 40, height: 20 }, color: BLACK });
    expect(detectBackground(png)).toEqual({ kind: 'transparent' });
  });

  it('reads a uniform white matte as light, so it can be stripped', () => {
    const jpeg = image(100, 100, WHITE, { box: { left: 20, top: 30, width: 60, height: 40 }, color: BLACK });
    expect(detectBackground(jpeg)).toEqual({ kind: 'light', color: [255, 255, 255] });
  });

  it('reads a uniform dark border as opaque rather than strippable padding', () => {
    // A wordmark reversed out of a black badge: the black *is* the logo.
    const badge = image(64, 64, BLACK, { box: { left: 16, top: 24, width: 32, height: 16 }, color: WHITE });
    expect(detectBackground(badge)).toEqual({ kind: 'opaque', color: [0, 0, 0] });
  });

  it('reads a saturated uniform border as opaque even though it is bright', () => {
    const tile = image(64, 64, ORANGE, { box: { left: 20, top: 20, width: 24, height: 24 }, color: WHITE });
    expect(detectBackground(tile)).toMatchObject({ kind: 'opaque' });
  });

  it('reads a mark that bleeds to the edge as busy', () => {
    const bleeding = image(64, 64, WHITE, { box: { left: 0, top: 0, width: 40, height: 64 }, color: BLACK });
    expect(detectBackground(bleeding)).toEqual({ kind: 'busy' });
  });

  it('tolerates near-white matte noise within the uniformity threshold', () => {
    const nearWhite = image(64, 64, [252, 250, 251, 255], { box: { left: 10, top: 10, width: 8, height: 8 }, color: BLACK });
    expect(detectBackground(nearWhite)).toMatchObject({ kind: 'light' });
  });
});

describe('contentBox', () => {
  it('finds the mark inside transparent padding', () => {
    const png = image(100, 100, TRANSPARENT, { box: { left: 30, top: 40, width: 40, height: 20 }, color: BLACK });
    expect(contentBox(png, { kind: 'transparent' })).toEqual({ left: 30, top: 40, width: 40, height: 20 });
  });

  it('finds the mark inside a white matte', () => {
    const jpeg = image(100, 100, WHITE, { box: { left: 12, top: 8, width: 50, height: 30 }, color: BLACK });
    expect(contentBox(jpeg, { kind: 'light', color: [255, 255, 255] })).toEqual({
      left: 12,
      top: 8,
      width: 50,
      height: 30,
    });
  });

  it('returns null for an image that is entirely background', () => {
    expect(contentBox(image(20, 20, TRANSPARENT), { kind: 'transparent' })).toBeNull();
  });

  it('returns the whole image when the mark already fills it', () => {
    expect(contentBox(image(10, 10, BLACK), { kind: 'transparent' })).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    });
  });
});

describe('planNormalization', () => {
  it('trims transparent padding and centres the mark on the canvas', () => {
    const png = image(400, 400, TRANSPARENT, { box: { left: 100, top: 180, width: 200, height: 40 }, color: BLACK });
    const plan = planNormalization(png);

    expect(plan.decision).toBe('trimmed');
    expect(plan.crop).toEqual({ left: 100, top: 180, width: 200, height: 40 });
    // 200x40 fits the 384x256 inner box on width: 384/200 > 256/40 is false,
    // so height is not the constraint — but neither may upscale past 1:1.
    expect(plan.placement.width / plan.placement.height).toBeCloseTo(5, 5);
    expect(plan.canvas).toEqual({ width: 480, height: 320 });
    // Centred on both axes.
    expect(plan.placement.left).toBe(Math.floor((480 - plan.placement.width) / 2));
    expect(plan.placement.top).toBe(Math.floor((320 - plan.placement.height) / 2));
  });

  it('never upscales a source smaller than the target box', () => {
    const small = image(120, 60, TRANSPARENT, { box: { left: 0, top: 0, width: 120, height: 60 }, color: BLACK });
    const plan = planNormalization(small);

    expect(plan.placement.width).toBe(120);
    expect(plan.placement.height).toBe(60);
    expect(plan.belowTargetSize).toBe(true);
  });

  it('scales an oversized mark down to the inner box, preserving aspect', () => {
    const wide = image(4000, 500, TRANSPARENT, { box: { left: 0, top: 0, width: 4000, height: 500 }, color: BLACK });
    const plan = planNormalization(wide);

    expect(plan.placement.width).toBe(384); // 480 - 2 * 10% padding
    expect(plan.placement.height).toBe(48); // 384 / 8, aspect preserved
    expect(plan.belowTargetSize).toBe(false);
  });

  it('keeps a dark-background mark untrimmed and pads it transparently', () => {
    const badge = image(200, 200, BLACK, { box: { left: 60, top: 90, width: 80, height: 20 }, color: WHITE });
    const plan = planNormalization(badge);

    expect(plan.decision).toBe('kept-opaque-background');
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 200, height: 200 });
    // Extending the badge's own black would turn it into a full-bleed tile.
    expect(plan.canvasBackground).toBeNull();
  });

  it('re-lays a stripped white matte across the whole tile so padding is seamless', () => {
    const jpeg = image(200, 200, WHITE, { box: { left: 40, top: 80, width: 120, height: 40 }, color: BLACK });
    const plan = planNormalization(jpeg);

    expect(plan.decision).toBe('trimmed');
    expect(plan.canvasBackground).toEqual([255, 255, 255]);
  });

  it('rejects a trim that would retain only a sliver', () => {
    // Three stray pixels in a 200px canvas: the background read is wrong, or
    // the asset is broken. Either way, shipping a 3px mark is worse.
    const speck = image(200, 200, TRANSPARENT, { box: { left: 100, top: 100, width: 3, height: 3 }, color: BLACK });
    const plan = planNormalization(speck);

    expect(plan.decision).toBe('kept-trim-too-aggressive');
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 200, height: 200 });
  });

  it('keeps a fully blank image rather than cropping to nothing', () => {
    const plan = planNormalization(image(50, 50, TRANSPARENT));
    expect(plan.decision).toBe('kept-blank-image');
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 50, height: 50 });
  });

  it('reports an already-tight mark without re-cropping it', () => {
    // A cross reaching all four edge midpoints: the border ring still reads as
    // transparent, but there is nothing left to trim.
    const cross = image(
      200,
      200,
      TRANSPARENT,
      { box: { left: 0, top: 90, width: 200, height: 20 }, color: BLACK },
      { box: { left: 90, top: 0, width: 20, height: 200 }, color: BLACK },
    );
    const plan = planNormalization(cross);

    expect(plan.background).toEqual({ kind: 'transparent' });
    expect(plan.decision).toBe('already-tight');
    expect(plan.crop).toEqual({ left: 0, top: 0, width: 200, height: 200 });
  });

  it('treats a solid single-colour image as an opaque tile, not padding', () => {
    const plan = planNormalization(image(300, 200, BLACK));
    expect(plan.decision).toBe('kept-opaque-background');
    expect(plan.canvasBackground).toBeNull();
  });

  it('honours a caller-supplied canvas and padding', () => {
    const png = image(1000, 1000, TRANSPARENT, { box: { left: 250, top: 250, width: 500, height: 500 }, color: BLACK });
    const plan = planNormalization(png, { ...DEFAULT_OPTIONS, canvasWidth: 200, canvasHeight: 200, paddingRatio: 0.25 });

    expect(plan.canvas).toEqual({ width: 200, height: 200 });
    expect(plan.placement.width).toBe(100); // 200 - 2 * 25%
    expect(plan.placement.height).toBe(100);
  });
});

describe('dilateAlpha', () => {
  const alphaAt = (grown: Uint8Array, width: number, x: number, y: number) => grown[y * width + x];

  it('grows an opaque block outwards by the radius', () => {
    const img = image(21, 21, TRANSPARENT, { box: { left: 10, top: 10, width: 1, height: 1 }, color: BLACK });
    const grown = dilateAlpha(img, 3);

    // Along an axis the disc reaches exactly the radius, and no further.
    expect(alphaAt(grown, 21, 13, 10)).toBe(255);
    expect(alphaAt(grown, 21, 14, 10)).toBe(0);
    expect(alphaAt(grown, 21, 10, 7)).toBe(255);
    expect(alphaAt(grown, 21, 10, 6)).toBe(0);
  });

  it('uses a disc, so corners stay clear of a square of the same radius', () => {
    const img = image(21, 21, TRANSPARENT, { box: { left: 10, top: 10, width: 1, height: 1 }, color: BLACK });
    const grown = dilateAlpha(img, 3);

    // (3,3) away is 4.24 from the centre — outside the disc, inside a box.
    expect(alphaAt(grown, 21, 13, 13)).toBe(0);
    expect(alphaAt(grown, 21, 12, 12)).toBe(255); // 2.83 away, inside it
  });

  it('carries a partly transparent edge through at its own strength', () => {
    const img = image(11, 11, TRANSPARENT, {
      box: { left: 5, top: 5, width: 1, height: 1 },
      color: [0, 0, 0, 128],
    });
    const grown = dilateAlpha(img, 2);
    expect(alphaAt(grown, 11, 7, 5)).toBe(128);
  });

  it('leaves the alpha untouched at radius zero', () => {
    const img = image(5, 5, TRANSPARENT, { box: { left: 2, top: 2, width: 1, height: 1 }, color: BLACK });
    expect(Array.from(dilateAlpha(img, 0)).filter((a) => a === 255)).toHaveLength(1);
  });
});

describe('paintHalo', () => {
  it('puts white under the mark and leaves the mark itself alone', () => {
    const img = image(11, 11, TRANSPARENT, { box: { left: 5, top: 5, width: 1, height: 1 }, color: ORANGE });
    const out = paintHalo(img, 2);
    const at = (x: number, y: number) => Array.from(out.subarray((y * 11 + x) * 4, (y * 11 + x) * 4 + 4));

    expect(at(5, 5)).toEqual([...ORANGE]); // the mark, unchanged
    expect(at(7, 5)).toEqual([255, 255, 255, 255]); // ground it grew
    expect(at(9, 5)).toEqual([0, 0, 0, 0]); // beyond the halo, still clear
  });

  it('changes nothing on a tile that is already opaque edge to edge', () => {
    const img = image(9, 9, WHITE, { box: { left: 3, top: 3, width: 3, height: 3 }, color: BLACK });
    const out = paintHalo(img, 2);
    expect(Array.from(out)).toEqual(Array.from(img.data));
  });
});

describe('haloRadius', () => {
  it('scales with the mark, so every logo gets the same weight once scaled', () => {
    const tall = image(200, 200, TRANSPARENT, { box: { left: 60, top: 20, width: 80, height: 160 }, color: BLACK });
    const short = image(200, 200, TRANSPARENT, { box: { left: 20, top: 80, width: 160, height: 40 }, color: BLACK });
    const options = { ...DEFAULT_OPTIONS, canvasWidth: 200, canvasHeight: 200, paddingRatio: 0.1 };

    const tallPlan = planNormalization(tall, options);
    const shortPlan = planNormalization(short, options);

    expect(haloRadius(tallPlan, options)).toBe(Math.round(0.09 * tallPlan.placement.height));
    expect(haloRadius(shortPlan, options)).toBe(Math.round(0.09 * shortPlan.placement.height));
  });

  it('never grows past the padding, so the ground cannot run off the canvas', () => {
    const img = image(100, 100, TRANSPARENT, { box: { left: 2, top: 2, width: 96, height: 96 }, color: BLACK });
    const options = { ...DEFAULT_OPTIONS, canvasWidth: 100, canvasHeight: 100, paddingRatio: 0.02, haloRatio: 0.9 };
    const plan = planNormalization(img, options);
    const room = Math.min(plan.placement.left, plan.placement.top);

    expect(haloRadius(plan, options)).toBe(room);
  });
});
