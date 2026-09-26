// src/lib/album-cover.ts
//
// An album's cover, for the /photos cards and the link preview of each
// gallery page. Returns an address Astro's image pipeline downloads once at
// build time, crops to 16:9, and serves from replaycon.in; visitors never
// fetch a cover from anywhere else.
//
//   Google Photos: the album's own cover, from its Open Graph tags — the
//                  picture any chat app shows when the link is pasted.
//   Google Drive:  Drive has no album cover, so it is the first *landscape*
//                  photo in the gallery, found by reading the size of small
//                  thumbnails; a phone's portrait shot cropped to 16:9 loses
//                  everyone's faces. Failing a landscape one, the first photo.
//                  Photos loose in the album's top folder come first, so
//                  putting one there is how to choose the cover.
//
// Never throws, and never hands Astro something it cannot use: a cover Astro
// fails to download or transform stops the whole build, so every cover is
// fetched and checked here first. An album without a usable one gets a card
// without a cover and a warning.

import { albumHost, coverAtSize, imageSize, imagesInOrder, isLandscape, readOpenGraph } from './photos';
import { galleryApiUrl, shareableImageUrl, type GalleryBody } from './gallery';

const TIMEOUT_MS = 10_000;

// Tested 2026-09-24: a browser user agent gets an "open in the app" page from
// the short link; anything else is redirected to the album itself. So the
// build says what it is.
const USER_AGENT = 'REPLAY-site-build/1.0 (+https://replaycon.in)';

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 900;
/** How many Drive photos to measure before settling for the first one. */
const MAX_PROBES = 40;

/** True when `url` answers with an image right now, so Astro can use it. */
async function usableImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ok = res.ok && (res.headers.get('Content-Type') ?? '').startsWith('image/');
    await res.arrayBuffer().catch(() => undefined);
    return ok;
  } catch {
    return false;
  }
}

async function googlePhotosCover(url: string): Promise<string | null> {
  const res = await fetch(url, {
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
}

async function driveCover(slug: string, workerUrl: string): Promise<string | null> {
  const res = await fetch(galleryApiUrl(workerUrl, slug), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    console.warn(`[photos] ${slug}: gallery ${res.status}; showing the album without a cover.`);
    return null;
  }
  const images = imagesInOrder(((await res.json()) as GalleryBody).sections ?? []);
  if (!images.length) {
    console.warn(`[photos] ${slug}: no photo in the album; showing it without a cover.`);
    return null;
  }
  let chosen = images[0];
  for (const photo of images.slice(0, MAX_PROBES)) {
    try {
      const thumb = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(photo.id)}&sz=w200`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (thumb.ok && isLandscape(imageSize(new Uint8Array(await thumb.arrayBuffer())))) {
        chosen = photo;
        break;
      }
    } catch {
      // One thumbnail that will not load is not a reason to stop looking.
    }
  }
  return shareableImageUrl(workerUrl, 'google_drive', chosen.id);
}

// /photos and each gallery page both want the same cover in one build.
const once = new Map<string, Promise<string | null>>();

export function fetchAlbumCover(
  url: string | null | undefined,
  slug: string,
  workerUrl: string = import.meta.env.PUBLIC_WORKER_URL ?? '',
): Promise<string | null> {
  const host = albumHost(url);
  if (!host) return Promise.resolve(null);
  const key = `${slug}|${url}`;
  let pending = once.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const cover = host === 'google-photos'
          ? await googlePhotosCover(url as string)
          : workerUrl ? await driveCover(slug, workerUrl) : null;
        if (cover && !(await usableImage(cover))) {
          console.warn(`[photos] ${slug}: cover ${cover} is not an image right now; showing the album without one.`);
          return null;
        }
        return cover;
      } catch (error) {
        console.warn(`[photos] ${url}: ${error instanceof Error ? error.message : String(error)}; showing the album without a cover.`);
        return null;
      }
    })();
    once.set(key, pending);
  }
  return pending;
}
