// worker/src/edition-photos.ts
//
// The on-site photo gallery at replaycon.in/photos/<slug>/ reads its photos
// from here, at view time, so a photographer adding pictures to the album
// shows up without a rebuild.
//
//   GET /api/photos/:slug                    the edition's album, in sections
//   GET /api/photos/image/:source/:id        one photo, same-origin-readable
//
// An edition's `photos_url` is either a Google Photos shared album or a Google
// Drive folder (the admin only accepts those two hosts).
//
// Google Photos has no API for someone else's album, so it is read the way
// bgc-website reads its event albums (google-photos.ts, ported unchanged): from
// the album's public share page. Drive folders go through the Drive API, which
// needs the Worker secret DRIVE_API_KEY. REPLAY's Drive albums keep one
// subfolder per photographer ("Amrit", "Cats from Hell"), so the folder is read
// one level deep and each subfolder becomes a section of the gallery.
//
// Everything fails soft: an album this cannot read answers with its link, and
// the page offers "Open the album" instead of a broken grid.
//
// Design: docs/specs/2026-09-24-between-editions-design.md (photos on the page
// were an open decision there; the organiser chose them on 2026-09-25).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import { CORS_HEADERS } from './validation';
import { serviceClient } from './supabase';
import { editionName } from './format';
import {
  fetchGoogleAlbum,
  isValidMediaToken,
  normalizeGooglePhotosUrl,
  type GoogleAlbum,
} from './google-photos';

export interface GalleryPhoto {
  /** The Google Photos media token, or the Drive file id. */
  id: string;
  /** A file name for downloads and the share sheet: "replay-3e-12.jpg". */
  name: string;
  kind: 'image' | 'video';
  /** Grid tile, about 480px. */
  thumbUrl: string;
  /** Lightbox size, about 1600px. */
  fullUrl: string;
  /** The item on Google — where a video plays, and what "Copy link" falls back to. */
  viewUrl: string;
  /** Full-resolution original, served by Google as an attachment. */
  downloadUrl: string;
}

export interface GallerySection {
  /** The photographer's subfolder name; null for photos not in a subfolder. */
  title: string | null;
  photos: GalleryPhoto[];
}

export interface GalleryBody {
  source: 'google_photos' | 'google_drive';
  albumUrl: string;
  /** False when a large album could only be read in part. */
  complete: boolean;
  sections: GallerySection[];
}

export type AlbumSource =
  | { kind: 'google_photos'; url: string }
  | { kind: 'google_drive'; folderId: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const DRIVE_FOLDER_PATH = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})\/?$/;
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
// Safety stops, not expected limits: a photographer per subfolder, a few
// hundred photos each.
const MAX_SUBFOLDERS = 40;
const MAX_DRIVE_PAGES = 5;
// Reading REPLAY 3E's album (763 items, three pages) takes about nine seconds
// from cold, so a read is kept for an hour: photos added to an album appear
// within the hour, and almost nobody waits for the slow read.
const ALBUM_CACHE = 'public, max-age=3600';

/** What kind of album a `photos_url` is, or null when it cannot be read here. */
export function albumSource(url: string | null | undefined): AlbumSource | null {
  if (!url) return null;
  const photos = normalizeGooglePhotosUrl(url);
  if (photos) return { kind: 'google_photos', url: photos };
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com') return null;
  const folder = parsed.pathname.match(DRIVE_FOLDER_PATH);
  return folder ? { kind: 'google_drive', folderId: folder[1] } : null;
}

/** "replay-3" → "replay-3e", the stem of every downloaded file's name. */
function fileStem(slug: string): string {
  return editionName(slug).toLowerCase().replace(/\s+/g, '-');
}

export function googlePhotosSection(album: GoogleAlbum, slug: string): GallerySection {
  const stem = fileStem(slug);
  return {
    title: null,
    photos: album.items.map((item, i) => ({
      id: item.token,
      name: `${stem}-${i + 1}.${item.isVideo ? 'mp4' : 'jpg'}`,
      kind: item.isVideo ? 'video' : 'image',
      thumbUrl: `${item.baseUrl}=w480-h480-c`,
      fullUrl: `${item.baseUrl}=w1600-h1600`,
      viewUrl: `https://photos.google.com/share/${album.albumKey}/photo/${item.mediaKey}?key=${album.authKey}`,
      downloadUrl: `${item.baseUrl}=${item.isVideo ? 'dv' : 'd'}`,
    })),
  };
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
}

function isMedia(file: DriveFile): boolean {
  return Boolean(file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/'));
}

export function drivePhoto(file: DriveFile): GalleryPhoto {
  return {
    id: file.id,
    name: file.name,
    kind: file.mimeType?.startsWith('video/') ? 'video' : 'image',
    thumbUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w480`,
    fullUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`,
    viewUrl: `https://drive.google.com/file/d/${file.id}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${file.id}`,
  };
}

/**
 * The gallery's sections from a Drive folder: loose photos first, untitled,
 * then one section per subfolder in name order. Empty sections are dropped,
 * and so is anything that is neither a photo nor a video.
 */
export function driveSections(loose: DriveFile[], subfolders: Array<{ name: string; files: DriveFile[] }>): GallerySection[] {
  const sections: GallerySection[] = [];
  const top = loose.filter(isMedia);
  if (top.length) sections.push({ title: null, photos: top.map(drivePhoto) });
  const named = [...subfolders].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
  for (const folder of named) {
    const media = folder.files.filter(isMedia);
    if (media.length) sections.push({ title: folder.name.trim(), photos: media.map(drivePhoto) });
  }
  return sections;
}

async function driveChildren(folderId: string, key: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_DRIVE_PAGES; page++) {
    const url = new URL(DRIVE_API);
    // folderId has passed DRIVE_ID, so it cannot close the quoted string.
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('orderBy', 'name');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('key', key);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`drive_${res.status}`);
    const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(body.files ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return files;
}

async function readDriveAlbum(folderId: string, key: string): Promise<GallerySection[]> {
  const top = await driveChildren(folderId, key);
  const folders = top.filter((f) => f.mimeType === DRIVE_FOLDER_MIME && DRIVE_ID.test(f.id)).slice(0, MAX_SUBFOLDERS);
  const subfolders = await Promise.all(
    folders.map(async (folder) => ({ name: folder.name, files: await driveChildren(folder.id, key) })),
  );
  return driveSections(top, subfolders);
}

function respond(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...CORS_HEADERS },
  });
}

/** An album that cannot be shown here still has a link the page can offer. */
const unreadable = (error: string, albumUrl: string, status = 502) => respond({ error, albumUrl }, status, 'no-store');

export async function buildGallery(sb: SupabaseClient, env: Pick<Env, 'DRIVE_API_KEY'>, slug: string): Promise<Response> {
  if (!SLUG.test(slug)) return respond({ error: 'not_found' }, 404, 'no-store');
  const { data: edition, error } = await sb
    .from('editions')
    .select('slug, photos_url, is_published')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.error('gallery_edition_lookup_failed', error.message);
    return respond({ error: 'gallery_unavailable' }, 503, 'no-store');
  }
  const albumUrl: string | null = edition?.photos_url ?? null;
  if (!edition || !edition.is_published || !albumUrl) return respond({ error: 'not_found' }, 404, 'no-store');

  const source = albumSource(albumUrl);
  if (!source) return unreadable('unreadable_album', albumUrl);

  if (source.kind === 'google_photos') {
    const album = await fetchGoogleAlbum(source.url).catch(() => null);
    if (!album) return unreadable('unreadable_album', albumUrl);
    const body: GalleryBody = {
      source: 'google_photos',
      albumUrl,
      complete: album.complete,
      sections: [googlePhotosSection(album, edition.slug)],
    };
    return respond(body, 200, ALBUM_CACHE);
  }

  if (!env.DRIVE_API_KEY) return unreadable('drive_not_configured', albumUrl, 503);
  try {
    const body: GalleryBody = {
      source: 'google_drive',
      albumUrl,
      complete: true,
      sections: await readDriveAlbum(source.folderId, env.DRIVE_API_KEY),
    };
    return respond(body, 200, ALBUM_CACHE);
  } catch (err) {
    console.error('gallery_drive_failed', err instanceof Error ? err.message : String(err));
    return unreadable('unreadable_album', albumUrl);
  }
}

/**
 * Edge-cache successful answers (an hour for albums, ten minutes for single
 * photos), so a gallery that a lot of people open reads Google once per colo,
 * not once per visitor. `caches` is
 * absent under Vitest, which then builds every response directly.
 */
async function withCache(req: Request, ctx: ExecutionContext | undefined, build: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  if (!cache) return build();
  const key = new Request(new URL(req.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await build();
  if (res.status === 200 && ctx) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function limited(req: Request, env: Env, bucket: string): Promise<Response | null> {
  if (!env.PUBLIC_RATE_LIMITER) return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `${bucket}:ip:${ip}` });
  return success ? null : respond({ error: 'rate_limited' }, 429, 'no-store');
}

export async function handleGallery(req: Request, env: Env, ctx: ExecutionContext | undefined, slug: string): Promise<Response> {
  return (await limited(req, env, 'gallery')) ?? withCache(req, ctx, () => buildGallery(serviceClient(env), env, slug));
}

/**
 * One photo at lightbox size, served from api.replaycon.in with CORS, because
 * the share sheet needs the photo as a file and Google's image hosts do not
 * let another origin read their bytes. Only a shared-album media token or a
 * Drive file id is accepted, so this cannot be pointed at an arbitrary URL.
 */
export async function buildPhotoImage(source: string, id: string): Promise<Response> {
  let upstream: string;
  if (source === 'google' && isValidMediaToken(id)) upstream = `https://lh3.googleusercontent.com/pw/${id}=w1600-h1600`;
  else if (source === 'drive' && DRIVE_ID.test(id)) upstream = `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
  else return respond({ error: 'invalid_photo' }, 400, 'no-store');

  const res = await fetch(upstream);
  const type = res.headers.get('Content-Type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return respond({ error: 'not_found' }, 404, 'no-store');
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=600', ...CORS_HEADERS },
  });
}

export async function handlePhotoImage(
  req: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  source: string,
  id: string,
): Promise<Response> {
  return (await limited(req, env, 'gallery-image')) ?? withCache(req, ctx, () => buildPhotoImage(source, id));
}
