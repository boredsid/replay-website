// src/lib/album-cover.ts
//
// The one piece of /photos that talks to Google: follow an album link, read
// its Open Graph cover, and hand back an address Astro's image pipeline can
// download at build time and serve from replaycon.in. Visitors never fetch
// anything from Google, and the site's CSP needs no new image host.
//
// Never throws. A cover is decoration; an album whose page Google has changed,
// or a build with no network, gets a card without one and a warning.

import { albumHost, coverAtSize, readOpenGraph } from './photos';

const TIMEOUT_MS = 10_000;

// Tested 2026-09-24: a browser user agent gets an "open in the app" page from
// the short link; anything else is redirected to the album itself. So the
// build says what it is.
const USER_AGENT = 'REPLAY-site-build/1.0 (+https://replaycon.in)';

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 900;

export async function fetchAlbumCover(url: string | null | undefined): Promise<string | null> {
  // Drive folders publish Drive's own logo as their cover; not worth fetching.
  if (albumHost(url) !== 'google-photos') return null;
  try {
    const res = await fetch(url as string, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[photos] ${url}: ${res.status}; showing the album without a cover.`);
      return null;
    }
    const cover = coverAtSize(readOpenGraph(await res.text()).image, COVER_WIDTH, COVER_HEIGHT);
    if (!cover) console.warn(`[photos] ${url}: no usable og:image; showing the album without a cover.`);
    return cover;
  } catch (error) {
    console.warn(`[photos] ${url}: ${error instanceof Error ? error.message : String(error)}; showing the album without a cover.`);
    return null;
  }
}
