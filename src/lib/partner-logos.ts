import type { ImageMetadata } from 'astro';

export interface PartnerLogo {
  name: string;
  image: ImageMetadata;
}

type LogoModule = { default: ImageMetadata };

const logoModules = import.meta.glob<LogoModule>(
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

export const partnerLogos: PartnerLogo[] = Object.entries(logoModules)
  .map(([path, module]) => ({
    name: nameFromPath(path),
    image: module.default,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
