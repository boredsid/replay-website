// src/lib/photos.ts
//
// /photos: every finished edition's album, newest first, each card opening
// the edition's gallery (/photos/<slug>/, src/lib/gallery.ts). This module
// decides which albums are listed and what their links and covers are; the
// covers themselves are fetched in album-cover.ts.
//
// Pure: no fetching here, so every rule is testable against a string.

export type AlbumHost = 'google-photos' | 'google-drive';

/** Mirrors PHOTO_HOSTS in worker/src/admin/editions.ts, which is what lets a link in. */
const HOSTS: Record<string, AlbumHost> = {
  'photos.app.goo.gl': 'google-photos',
  'photos.google.com': 'google-photos',
  'drive.google.com': 'google-drive',
};

export const ALBUM_SERVICE: Record<AlbumHost, string> = {
  'google-photos': 'Google Photos',
  'google-drive': 'Google Drive',
};

export function albumHost(url: string | null | undefined): AlbumHost | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return HOSTS[parsed.hostname] ?? null;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaContent(html: string, property: string): string | undefined {
  // Attribute order varies between pages; accept either.
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]*\\bproperty=["']${escaped}["'][^>]*\\bcontent=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\bproperty=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]).trim() || undefined;
  }
  return undefined;
}

/** The link-preview tags an album page publishes for chat apps. */
export function readOpenGraph(html: string): { image?: string; title?: string } {
  return { image: metaContent(html, 'og:image'), title: metaContent(html, 'og:title') };
}

/**
 * The same cover at a size worth showing. Google serves `og:image` at 600x315;
 * the size lives in the `=w…-h…` suffix of an lh3.googleusercontent.com
 * address, and any size can be asked for. Null for any other host, because a
 * rewrite of an address we do not understand would fetch something else.
 */
export function coverAtSize(ogImage: string | undefined, width: number, height: number): string | null {
  if (!ogImage) return null;
  let url: URL;
  try {
    url = new URL(ogImage);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'lh3.googleusercontent.com') return null;
  const size = `=w${width}-h${height}-p-k-no`;
  const path = url.pathname.includes('=') ? url.pathname.replace(/=[^/=]*$/, size) : `${url.pathname}${size}`;
  return `${url.origin}${path}`;
}

/** Every photo in gallery order, videos left out: the candidates for a Drive cover. */
export function imagesInOrder<P extends { kind: 'image' | 'video' }>(sections: Array<{ photos: P[] }>): P[] {
  return sections.flatMap((section) => section.photos.filter((p) => p.kind === 'image'));
}

/**
 * Width and height from the first bytes of a JPEG or PNG, or null for anything
 * else. Enough to tell a landscape photo from a portrait one without decoding
 * it, and without a native image library in a module the pages import.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG: the IHDR chunk always comes first.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  // JPEG: walk the segments to the first start-of-frame marker.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

/** Wide enough to fill a 16:9 cover without losing people off the top and bottom. */
export function isLandscape(size: { width: number; height: number } | null): boolean {
  return Boolean(size && size.width >= size.height * 1.2);
}

export interface AlbumEdition {
  slug: string;
  start_date: string;
  end_date: string;
  photos_url: string | null;
}

/**
 * The editions /photos lists, newest first, and whether the most recent one
 * is still waiting for its album — in which case the page opens by saying so.
 */
export function albumCards<E extends AlbumEdition>(pastEditions: E[], recapSlug: string | null): { albums: E[]; awaiting: E | null } {
  const newestFirst = [...pastEditions].sort((a, b) => b.end_date.localeCompare(a.end_date));
  const albums = newestFirst.filter((e) => albumHost(e.photos_url) !== null);
  const recap = recapSlug ? newestFirst.find((e) => e.slug === recapSlug) ?? null : null;
  const awaiting = recap && albumHost(recap.photos_url) === null ? recap : null;
  return { albums, awaiting };
}
