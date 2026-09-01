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
