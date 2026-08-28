import type { ImageMetadata } from 'astro';
import { nameFromFile } from './sponsor-wall';

export interface PartnerLogo {
  name: string;
  image: ImageMetadata;
  /** Sponsorship tier — `title` and `association` also read the site header. */
  tier: string;
  /**
   * The mark's box inside the tile, in tile pixels. The wall shows the whole
   * padded tile; the header crops to this so the mark, not the padding, is
   * what gets sized against the REPLAY wordmark.
   */
  mark: { width: number; height: number };
  /** Whether the header lockup may use this logo; see `sponsors.show_in_header`. */
  inHeader: boolean;
  /** Where the logo links, or null when it is not clickable. */
  href: string | null;
}

type LogoModule = { default: ImageMetadata };
type ManifestEntry = {
  file: string;
  name: string;
  tier?: string;
  mark?: { width: number; height: number };
  inHeader?: boolean;
  href: string | null;
};
type ManifestModule = { default: ManifestEntry[] };

// Preferred source: tiles written by `scripts/normalize-sponsor-logos.ts`, each
// one the mark trimmed out of its original canvas and re-seated on a shared
// 3:2 canvas with fixed padding. The manifest beside them carries each logo's
// name, its link, and the order the wall should use — sponsors uploaded in the
// admin console first, then any artwork still living in `sponsor-logos/`.
// Generated at build time, gitignored.
// All three globs must stay string literals — Vite parses them statically.
const normalizedModules = import.meta.glob<LogoModule>('../generated/sponsor-logos/*.png', { eager: true });
const manifestModules = import.meta.glob<ManifestModule>('../generated/sponsor-logos/manifest.json', { eager: true });

// Fallback: the raw folder. The `sponsorLogos()` integration in
// astro.config.mjs regenerates the tiles on every dev and build, so this only
// engages if that integration is removed or fails. Rendering un-normalised
// logos is the pre-normaliser behaviour — visibly inconsistent, and with no
// links, but far better than an empty logo wall.
const rawModules = import.meta.glob<LogoModule>(
  '../../sponsor-logos/*.{avif,AVIF,jpeg,JPEG,jpg,JPG,png,PNG,svg,SVG,webp,WEBP}',
  { eager: true },
);

const manifest = Object.values(manifestModules)[0]?.default ?? [];

/** Generated tiles keyed by bare filename, e.g. "Board Game Company.png". */
const tilesByFile = new Map(
  Object.entries(normalizedModules).map(([path, module]) => [path.split('/').pop() ?? path, module.default]),
);

function fromManifest(): PartnerLogo[] {
  const logos: PartnerLogo[] = [];
  for (const entry of manifest) {
    const image = tilesByFile.get(entry.file);
    if (!image) {
      console.warn(`[sponsor-logos] manifest names "${entry.file}", which was not generated; skipping it.`);
      continue;
    }
    logos.push({
      name: entry.name,
      image,
      tier: entry.tier ?? 'community',
      // A tile written before the manifest carried a mark box: treat the whole
      // tile as the mark, which is the pre-crop framing.
      mark: entry.mark ?? { width: image.width, height: image.height },
      inHeader: entry.inHeader ?? true,
      href: entry.href,
    });
  }
  return logos;
}

function fromRawFolder(): PartnerLogo[] {
  if (Object.keys(rawModules).length > 0) {
    console.warn(
      '[sponsor-logos] no normalised tiles found; falling back to raw artwork. ' +
        'Run `npm run normalize:logos` (or build via `npm run build`) for a consistent logo wall.',
    );
  }
  return Object.entries(rawModules)
    .map(([path, module]) => ({
      name: nameFromFile(path.split('/').pop() ?? path),
      image: module.default,
      tier: 'community',
      mark: { width: module.default.width, height: module.default.height },
      inHeader: false,
      href: null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
}

export const partnerLogos: PartnerLogo[] = manifest.length > 0 ? fromManifest() : fromRawFolder();
