import type { ImageMetadata } from 'astro';

export interface PartnerLogo {
  name: string;
  image: ImageMetadata;
}

type LogoModule = { default: ImageMetadata };

// Preferred source: tiles written by `scripts/normalize-sponsor-logos.ts`, each
// one the mark trimmed out of its original canvas and re-seated on a shared
// 3:2 canvas with fixed padding. Generated at build time, gitignored.
// Both globs must stay string literals — Vite parses them statically.
const normalizedModules = import.meta.glob<LogoModule>('../generated/sponsor-logos/*.png', { eager: true });

// Fallback: the raw folder. The `sponsorLogos()` integration in
// astro.config.mjs regenerates the tiles on every dev and build, so this only
// engages if that integration is removed or fails. Rendering un-normalised
// logos is the pre-normaliser behaviour — visibly inconsistent, but far
// better than an empty logo wall.
const rawModules = import.meta.glob<LogoModule>(
  '../../sponsor-logos/*.{avif,AVIF,jpeg,JPEG,jpg,JPG,png,PNG,svg,SVG,webp,WEBP}',
  { eager: true },
);

function nameFromPath(path: string): string {
  const filename = path.split('/').pop() ?? path;
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const usingNormalized = Object.keys(normalizedModules).length > 0;

if (!usingNormalized && Object.keys(rawModules).length > 0) {
  console.warn(
    '[sponsor-logos] no normalised tiles found; falling back to raw artwork. ' +
      'Run `npm run normalize:logos` (or build via `npm run build`) for a consistent logo wall.',
  );
}

export const partnerLogos: PartnerLogo[] = Object.entries(usingNormalized ? normalizedModules : rawModules)
  .map(([path, module]) => ({
    name: nameFromPath(path),
    image: module.default,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
