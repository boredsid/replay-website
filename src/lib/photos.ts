// src/lib/photos.ts
//
// /photos: every finished edition's album, newest first.
//
// The site links to albums; it cannot show them. Google Photos answers
// `x-frame-options: SAMEORIGIN`, and since 31 March 2025 its API reads only
// media an app uploaded itself. What an album does publish is the Open Graph
// cover every chat app shows when the link is pasted, and that is the one
// picture the page uses — copied at build time (see album-cover.ts).
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
