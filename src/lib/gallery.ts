// src/lib/gallery.ts
//
// The on-site photo gallery (/photos/<slug>/): its addresses, and the shape of
// what the Worker returns. The photos themselves are read at view time from
// `GET /api/photos/:slug` (worker/src/edition-photos.ts), so new photos in an
// album appear without a rebuild.

/** Mirrors GalleryPhoto in worker/src/edition-photos.ts. */
export interface GalleryPhoto {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  fullUrl: string;
  viewUrl: string;
  downloadUrl: string;
}

export interface GallerySection {
  title: string | null;
  photos: GalleryPhoto[];
}

export interface GalleryBody {
  source: 'google_photos' | 'google_drive';
  albumUrl: string;
  complete: boolean;
  sections: GallerySection[];
}

/** The gallery page for an edition: "/photos/replay-3/". */
export function galleryPath(slug: string): string {
  return `/photos/${slug}/`;
}

function workerBase(workerUrl: string): string {
  return String(workerUrl).trim().replace(/\/$/, '');
}

export function galleryApiUrl(workerUrl: string, slug: string): string {
  return `${workerBase(workerUrl)}/api/photos/${encodeURIComponent(slug)}`;
}

/** The Worker's copy of one photo, which the browser may read to share it as a file. */
export function shareableImageUrl(workerUrl: string, source: GalleryBody['source'], photoId: string): string {
  const kind = source === 'google_photos' ? 'google' : 'drive';
  return `${workerBase(workerUrl)}/api/photos/image/${kind}/${encodeURIComponent(photoId)}`;
}

/** A link that opens this gallery with one photo already showing. */
export function photoLink(origin: string, slug: string, photoId: string): string {
  return `${origin.replace(/\/$/, '')}${galleryPath(slug)}?photo=${encodeURIComponent(photoId)}`;
}

/** Every photo in display order, so the lightbox can step across sections. */
export function flattenSections(sections: GallerySection[]): GalleryPhoto[] {
  return sections.flatMap((section) => section.photos);
}

/** "285 photos and 101 videos", "1 photo", "12 videos". */
export function countLabel(photos: GalleryPhoto[]): string {
  const videos = photos.filter((p) => p.kind === 'video').length;
  const images = photos.length - videos;
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (images && videos) return `${part(images, 'photo')} and ${part(videos, 'video')}`;
  return videos ? part(videos, 'video') : part(images, 'photo');
}
