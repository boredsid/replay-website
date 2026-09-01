// Draws the attendee app's icons from the admin app's, adding a cream ring.
//
// Both apps are the same navy tile with the same play mark, which is fine for
// attendees and a nuisance for organisers — anyone running both has two
// identical squares on their home screen. The ring is the only difference, so
// it has to survive the platform masks: iOS crops to a squircle and Android's
// maskable icons to a circle, and a ring drawn at the tile's edge would be
// eaten by both.
//
//   node scripts/make-app-icons.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RING = '#fff8e7';

/** The cream face of the play mark, which is the shape the badge is cut from. */
const CREAM = [253, 249, 237];

/**
 * A rounded-rect stroke as an overlay, sized for a 512px tile.
 *
 * `inset` is to the stroke's centre line, so the outer edge sits at
 * `inset - width / 2` from the tile edge — that is the number the masks cut
 * into, and the reason the maskable variant needs a bigger one.
 */
function ring({ inset, radius, width }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
      `<rect x="${inset}" y="${inset}" width="${512 - inset * 2}" height="${512 - inset * 2}" ` +
      `rx="${radius}" fill="none" stroke="${RING}" stroke-width="${width}"/>` +
      `</svg>`,
  );
}

async function stroked(source, geometry) {
  return sharp(join(root, 'admin/public', source))
    .resize(512, 512)
    .composite([{ input: ring(geometry) }])
    .png()
    .toBuffer();
}

// Clear of the iOS squircle: the outer edge lands ~73px from the corner on the
// diagonal, where the mask cuts at roughly 45px.
const TILE = { inset: 34, radius: 86, width: 22 };
// Clear of a circular mask, whose edge is 51px in from the flat sides.
const MASKABLE = { inset: 66, radius: 120, width: 20 };

const tile = await stroked('icon-512.png', TILE);
const maskable = await stroked('icon-maskable-512.png', MASKABLE);

const out = (name) => join(root, 'app/public', name);

await Promise.all([
  sharp(tile).toFile(out('icon-512.png')),
  sharp(maskable).toFile(out('icon-maskable-512.png')),
  sharp(tile).resize(192, 192).toFile(out('icon-192.png')),
  sharp(tile).resize(180, 180).toFile(out('apple-touch-icon.png')),
  sharp(tile).resize(32, 32).toFile(out('favicon-32.png')),
]);

console.log('Wrote app/public icons with the cream ring.');


/**
 * The notification badge: a silhouette, not an icon.
 *
 * Android masks the badge to its alpha channel and paints the result a flat
 * grey in the status bar, so a full-colour tile arrives as a solid grey square.
 * Only the shape survives, which means the shape has to be legible on its own
 * at about 24dp.
 *
 * That rules out the whole mark. Its three offset triangles collapse into one
 * silhouette with a stepped left edge, and the steps are illegible mush at
 * status-bar size. The front cream face alone is a clean play triangle, so the
 * badge is cut from just that: cream pixels become opaque white, everything
 * else transparent, then trimmed to the triangle and padded back out.
 *
 * iOS ignores `badge` entirely; this is Android-only.
 */
async function badge() {
  const source = sharp(join(root, 'admin/public/icon-512.png'));
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(512 * 512 * 4);

  for (let i = 0, p = 0; i < data.length; i += info.channels, p += 4) {
    // A tolerance rather than an equality: the mark's edges are anti-aliased,
    // and an exact match would leave the triangle with a ragged fringe.
    const near = Math.abs(data[i] - CREAM[0]) < 40
      && Math.abs(data[i + 1] - CREAM[1]) < 40
      && Math.abs(data[i + 2] - CREAM[2]) < 40;
    mask[p] = 255; mask[p + 1] = 255; mask[p + 2] = 255;
    mask[p + 3] = near ? 255 : 0;
  }

  const trimmed = await sharp(mask, { raw: { width: 512, height: 512, channels: 4 } })
    .png()
    .trim()
    .toBuffer();

  // Contained rather than cropped, with the padding transparent: Android adds
  // its own inset, and a triangle running edge to edge would collide with it.
  return sharp(trimmed)
    .resize(76, 76, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

await sharp(await badge()).toFile(out('badge-96.png'));

console.log('Wrote app/public/badge-96.png.');
