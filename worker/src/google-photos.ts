// Reads a link-shared Google Photos album.
//
// Ported unchanged from bgc-website worker/src/google-photos.ts (2026-09-25).
// Both sites read Google's page the same way; when Google changes it, fix the
// parse in both repos.
//
// Google Photos has no API for reading an album someone else shared (the
// Library API only sees media the calling app uploaded), so this reads the
// album's public share page the way a browser would. The page embeds the first
// batch of items as JSON in an `AF_initDataCallback(...)` script; larger albums
// hand back a page token, and the rest comes from the same `batchexecute` call
// the page itself makes when you scroll. None of this is a documented format:
// every parse step fails soft so a Google-side change degrades to "open the
// album on Google Photos" instead of an error page.

const SHORT_LINK_RE = /^https:\/\/photos\.app\.goo\.gl\/([A-Za-z0-9]+)\/?$/;
const SHARE_PATH_RE = /^\/(?:u\/\d+\/)?share\/([A-Za-z0-9_-]+)\/?$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
// Base URLs for shared-album media: https://lh3.googleusercontent.com/pw/<token>
const MEDIA_BASE_RE = /^https:\/\/lh3\.googleusercontent\.com\/pw\/([A-Za-z0-9_-]+)$/;
// The Photos web client's metadata key that only video items carry.
const VIDEO_META_KEY = '76647426';
const BATCH_URL = 'https://photos.google.com/_/PhotosUi/data/batchexecute';
const BATCH_RPC_ID = 'snAcKc';
// Each page is a few hundred items; this is a safety stop, not a real limit.
const MAX_PAGES = 20;

/**
 * Canonical form of an album share link, or null when it isn't one.
 * Accepts the short link Google Photos' "Share → Create link" produces and the
 * long share URL it redirects to. A `photos.google.com/album/...` address is
 * the owner's private view and deliberately does not pass.
 */
export function normalizeGooglePhotosUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const short = trimmed.match(SHORT_LINK_RE);
  if (short) return `https://photos.app.goo.gl/${short[1]}`;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'photos.google.com') return null;
  const share = url.pathname.match(SHARE_PATH_RE);
  const key = url.searchParams.get('key');
  if (!share || !key || !TOKEN_RE.test(key)) return null;
  return `https://photos.google.com/share/${share[1]}?key=${key}`;
}

export interface GoogleMediaItem {
  mediaKey: string; // the item's id inside the album, used in its photo-page URL
  token: string; // the lh3 base-URL token, which fetches the bytes
  baseUrl: string;
  isVideo: boolean;
}

export interface GoogleAlbumPage {
  items: GoogleMediaItem[];
  nextPageToken: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// One album entry: [mediaKey, [baseUrl, width, height, ...], takenAt, ..., {metadata}]
function parseItem(entry: unknown): GoogleMediaItem | null {
  if (!Array.isArray(entry) || typeof entry[0] !== 'string') return null;
  const media = entry[1];
  if (!Array.isArray(media) || typeof media[0] !== 'string') return null;
  const base = media[0].match(MEDIA_BASE_RE);
  if (!base) return null;
  const metadata = entry.find(isPlainObject);
  return {
    mediaKey: entry[0],
    token: base[1],
    baseUrl: media[0],
    isVideo: !!metadata && VIDEO_META_KEY in metadata,
  };
}

/** `data` is the album payload: [_, items, nextPageToken, albumInfo, ...]. */
export function parseAlbumData(data: unknown): GoogleAlbumPage | null {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return null;
  const items = data[1].map(parseItem).filter((i): i is GoogleMediaItem => i !== null);
  const next = data[2];
  return { items, nextPageToken: typeof next === 'string' && next.length > 0 ? next : null };
}

/** The first page of items, embedded in the share page's HTML. */
export function parseSharePage(html: string): GoogleAlbumPage | null {
  const callbacks = html.matchAll(/AF_initDataCallback\((\{[\s\S]*?)\);<\/script>/g);
  for (const [, body] of callbacks) {
    const data = body.match(/\bdata:([\s\S]*), sideChannel:/);
    if (!data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data[1]);
    } catch {
      continue;
    }
    const page = parseAlbumData(parsed);
    if (page && page.items.length > 0) return page;
  }
  return null;
}

/** A `batchexecute` response: an XSSI guard, then lines of JSON. */
export function parseBatchResponse(body: string): GoogleAlbumPage | null {
  const lines = body.replace(/^\)\]\}'/, '').split('\n');
  for (const line of lines) {
    if (!line.trimStart().startsWith('[[')) continue;
    try {
      const outer = JSON.parse(line) as unknown[];
      const hit = outer.find(
        (e) => Array.isArray(e) && e[0] === 'wrb.fr' && e[1] === BATCH_RPC_ID && typeof e[2] === 'string',
      ) as unknown[] | undefined;
      if (hit) return parseAlbumData(JSON.parse(hit[2] as string));
    } catch {
      // Not the line we want.
    }
  }
  return null;
}

async function fetchNextPage(albumKey: string, authKey: string, pageToken: string): Promise<GoogleAlbumPage | null> {
  const endpoint = new URL(BATCH_URL);
  endpoint.searchParams.set('rpcids', BATCH_RPC_ID);
  endpoint.searchParams.set('source-path', `/share/${albumKey}`);
  const request = JSON.stringify([albumKey, pageToken, null, authKey]);
  const res = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ 'f.req': JSON.stringify([[[BATCH_RPC_ID, request, null, 'generic']]]) }).toString(),
  });
  if (!res.ok) return null;
  return parseBatchResponse(await res.text());
}

export interface GoogleAlbum {
  albumKey: string;
  authKey: string;
  items: GoogleMediaItem[];
  complete: boolean; // false when a later page couldn't be read
}

/**
 * Fetches every item in a link-shared album. Returns null when even the first
 * page can't be read (album unshared or deleted, or Google changed the page).
 * A failure on a later page keeps what was already read and sets `complete`
 * false, so the site can show those and link to the rest.
 */
export async function fetchGoogleAlbum(shareUrl: string): Promise<GoogleAlbum | null> {
  const res = await fetch(shareUrl, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) return null;
  // The short link redirects to the long share URL, which carries both keys.
  let final: URL;
  try {
    final = new URL(res.url || shareUrl);
  } catch {
    return null;
  }
  const albumKey = final.hostname === 'photos.google.com' ? final.pathname.match(SHARE_PATH_RE)?.[1] : undefined;
  const authKey = final.searchParams.get('key');
  if (!albumKey || !authKey) return null;

  const first = parseSharePage(await res.text());
  if (!first) return null;

  const items = [...first.items];
  const seen = new Set(items.map((i) => i.mediaKey));
  let token = first.nextPageToken;
  let complete = true;
  for (let page = 2; token; page++) {
    if (page > MAX_PAGES) {
      complete = false;
      break;
    }
    const next = await fetchNextPage(albumKey, authKey, token).catch(() => null);
    if (!next) {
      complete = false;
      break;
    }
    for (const item of next.items) {
      if (!seen.has(item.mediaKey)) {
        seen.add(item.mediaKey);
        items.push(item);
      }
    }
    token = next.nextPageToken;
  }
  return { albumKey, authKey, items, complete };
}

export function isValidMediaToken(token: string): boolean {
  return token.length >= 20 && TOKEN_RE.test(token);
}
