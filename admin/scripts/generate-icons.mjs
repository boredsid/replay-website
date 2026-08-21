// Regenerates the admin PWA icon set from `public/replay-icon.png`.
//
// The source art is a circular badge on transparency with a thin orange stroke.
// Flattening it straight onto a square canvas kept that stroke as a 1-3px ring
// hugging the icon edge, clipped flat at the four cardinal points — visible as a
// stray arc once iOS or Android applies its own mask. So instead of flattening,
// we lift the play mark out of the badge interior and re-centre it on a
// full-bleed brand-navy square: nothing but flat colour reaches the edge.
//
// Run with `npm run icons` after changing the source art.

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SOURCE = join(PUBLIC_DIR, 'replay-icon.png');

// `markScale` is the fraction of the canvas the play mark spans. Maskable icons
// use a smaller mark so it stays inside the 80% safe circle every launcher mask
// is guaranteed to keep; small favicons use a larger one to stay legible.
const TARGETS = [
  { file: 'icon-192.png', size: 192, markScale: 0.6 },
  { file: 'icon-512.png', size: 512, markScale: 0.6 },
  { file: 'icon-maskable-512.png', size: 512, markScale: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, markScale: 0.6 },
  { file: 'favicon-32.png', size: 32, markScale: 0.68 },
];

// The badge stroke lives at the very edge of the source circle. Everything we
// care about sits well inside this radius, so we ignore the rest outright.
const INTERIOR_RADIUS = 0.47;

/* ---------------------------------------------------------------- PNG decode */

function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, i) => buffer[i] === byte)) throw new Error('not a PNG');

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!header) throw new Error('missing IHDR');
  if (header.depth !== 8) throw new Error(`unsupported bit depth ${header.depth}`);
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`unsupported colour type ${header.colorType}`);

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, read, read + stride);
    read += stride;
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = previous ? previous[x] : 0;
      const c = previous && x >= channels ? previous[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + a) & 0xff;
      else if (filter === 2) row[x] = (row[x] + b) & 0xff;
      else if (filter === 3) row[x] = (row[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) row[x] = (row[x] + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unknown row filter ${filter}`);
    }
  }

  // Normalise everything to RGBA so the caller only handles one layout.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 4;
    if (channels === 4) {
      pixels.copy(rgba, target, source, source + 4);
    } else if (channels === 3) {
      pixels.copy(rgba, target, source, source + 3);
      rgba[target + 3] = 255;
    } else if (channels === 2) {
      rgba.fill(pixels[source], target, target + 3);
      rgba[target + 3] = pixels[source + 1];
    } else {
      rgba.fill(pixels[source], target, target + 3);
      rgba[target + 3] = 255;
    }
  }

  return { width, height, data: rgba };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ---------------------------------------------------------------- PNG encode */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// Encodes opaque RGB. Icons never need an alpha channel: a transparent home
// screen icon is composited onto black by iOS, which is exactly the artefact
// this script exists to avoid.
function encodePng(rgb, size) {
  const stride = size * 3;
  const filtered = Buffer.alloc(size * (stride + 1));

  for (let y = 0; y < size; y += 1) {
    const out = y * (stride + 1);
    filtered[out] = 4; // Paeth compresses these flat fields well.
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= 3 ? rgb[(y - 1) * stride + x - 3] : 0;
      filtered[out + 1 + x] = (rgb[y * stride + x] - paeth(a, b, c)) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ analysis */

// Locates the play mark inside the badge and works out where its optical centre
// sits. A right-pointing triangle looks centred when its bounding box hangs
// right of centre and its centroid hangs left, so we split the difference
// instead of trusting either one alone.
function analyse({ width, height, data }) {
  const cx = width / 2;
  const cy = height / 2;
  const limit = INTERIOR_RADIUS * width;

  const counts = new Map();
  for (let i = 0; i < width * height; i += 1) {
    if (data[i * 4 + 3] < 250) continue;
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const background = [(dominant >> 16) & 0xff, (dominant >> 8) & 0xff, dominant & 0xff];

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 250) continue;
      if (Math.hypot(x - cx, y - cy) > limit) continue;
      const delta =
        Math.abs(data[i] - background[0]) +
        Math.abs(data[i + 1] - background[1]) +
        Math.abs(data[i + 2] - background[2]);
      if (delta <= 60) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
      count += 1;
    }
  }

  if (count === 0) throw new Error('no mark found inside the badge');

  const box = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const opticalCenter = {
    x: (sumX / count + (minX + maxX) / 2) / 2,
    y: (sumY / count + (minY + maxY) / 2) / 2,
  };

  return { background, box, opticalCenter };
}

/* ----------------------------------------------------------------- rendering */

// Copies the mark's bounding box onto a navy field big enough that the mark
// occupies `markScale` of it. The box carries badge navy in its own gaps, and
// the field is that same navy, so the copy is seamless and needs no alpha.
function compose(source, { background, box, opticalCenter }, markScale) {
  const field = Math.round(Math.max(box.width, box.height) / markScale);
  const rgb = Buffer.alloc(field * field * 3);
  for (let i = 0; i < field * field; i += 1) {
    rgb[i * 3] = background[0];
    rgb[i * 3 + 1] = background[1];
    rgb[i * 3 + 2] = background[2];
  }

  const offsetX = Math.round(field / 2 - (opticalCenter.x - box.x));
  const offsetY = Math.round(field / 2 - (opticalCenter.y - box.y));
  if (offsetX < 0 || offsetY < 0 || offsetX + box.width > field || offsetY + box.height > field) {
    throw new Error(`mark does not fit at scale ${markScale}`);
  }

  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const from = ((box.y + y) * source.width + box.x + x) * 4;
      const to = ((offsetY + y) * field + offsetX + x) * 3;
      rgb[to] = source.data[from];
      rgb[to + 1] = source.data[from + 1];
      rgb[to + 2] = source.data[from + 2];
    }
  }

  return { rgb, size: field };
}

// Area-averaged downscale, one axis at a time. Box filtering is the right choice
// here: the art is flat colour with hard edges, and anything sharper would
// reintroduce fringing along the triangle.
function resize(rgb, from, to) {
  const horizontal = new Float64Array(to * from * 3);
  const ratio = from / to;

  for (let x = 0; x < to; x += 1) {
    const start = x * ratio;
    const end = start + ratio;
    for (let sx = Math.floor(start); sx < Math.min(from, Math.ceil(end)); sx += 1) {
      const weight = Math.min(end, sx + 1) - Math.max(start, sx);
      if (weight <= 0) continue;
      for (let y = 0; y < from; y += 1) {
        const source = (y * from + sx) * 3;
        const target = (y * to + x) * 3;
        horizontal[target] += rgb[source] * weight;
        horizontal[target + 1] += rgb[source + 1] * weight;
        horizontal[target + 2] += rgb[source + 2] * weight;
      }
    }
  }

  const out = Buffer.alloc(to * to * 3);
  for (let y = 0; y < to; y += 1) {
    const start = y * ratio;
    const end = start + ratio;
    const accumulator = new Float64Array(to * 3);
    for (let sy = Math.floor(start); sy < Math.min(from, Math.ceil(end)); sy += 1) {
      const weight = Math.min(end, sy + 1) - Math.max(start, sy);
      if (weight <= 0) continue;
      for (let x = 0; x < to * 3; x += 1) accumulator[x] += horizontal[sy * to * 3 + x] * weight;
    }
    for (let x = 0; x < to * 3; x += 1) {
      out[y * to * 3 + x] = Math.max(0, Math.min(255, Math.round(accumulator[x] / (ratio * ratio))));
    }
  }

  return out;
}

/* ---------------------------------------------------------------------- main */

const source = decodePng(readFileSync(SOURCE));
const mark = analyse(source);
const hex = `#${mark.background.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

console.log(`source ${source.width}x${source.height}, field ${hex}`);
console.log(
  `mark ${mark.box.width}x${mark.box.height} at ${mark.box.x},${mark.box.y}` +
    ` — optical centre ${mark.opticalCenter.x.toFixed(1)},${mark.opticalCenter.y.toFixed(1)}`,
);

for (const target of TARGETS) {
  const { rgb, size } = compose(source, mark, target.markScale);
  const scaled = size === target.size ? rgb : resize(rgb, size, target.size);
  const png = encodePng(scaled, target.size);
  writeFileSync(join(PUBLIC_DIR, target.file), png);
  console.log(
    `${target.file.padEnd(24)} ${String(target.size).padStart(3)}px` +
      ` mark ${Math.round(target.markScale * 100)}%  ${(png.length / 1024).toFixed(1)} KB`,
  );
}
