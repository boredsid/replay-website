import { describe, expect, it } from 'vitest';
import { countLabel, flattenSections, galleryApiUrl, galleryPath, photoLink, shareableImageUrl, type GalleryPhoto } from './gallery';

const p = (id: string, kind: GalleryPhoto['kind'] = 'image') => ({ id, kind }) as GalleryPhoto;

describe('gallery addresses', () => {
  it('builds the page, API, share-proxy and deep-link addresses', () => {
    expect(galleryPath('replay-3')).toBe('/photos/replay-3/');
    expect(galleryApiUrl('https://api.replaycon.in/ ', 'replay-3')).toBe('https://api.replaycon.in/api/photos/replay-3');
    expect(shareableImageUrl('https://api.replaycon.in', 'google_photos', 'AP1Gcz_x')).toBe('https://api.replaycon.in/api/photos/image/google/AP1Gcz_x');
    expect(shareableImageUrl('https://api.replaycon.in', 'google_drive', '1AbCdEfGhIj')).toBe('https://api.replaycon.in/api/photos/image/drive/1AbCdEfGhIj');
    expect(photoLink('https://replaycon.in/', 'replay-3', 'a b')).toBe('https://replaycon.in/photos/replay-3/?photo=a%20b');
  });
});

describe('countLabel', () => {
  it('counts photos and videos in words', () => {
    expect(countLabel([p('a'), p('b'), p('c', 'video')])).toBe('2 photos and 1 video');
    expect(countLabel([p('a')])).toBe('1 photo');
    expect(countLabel([p('a', 'video'), p('b', 'video')])).toBe('2 videos');
  });
});

describe('flattenSections', () => {
  it('keeps display order across sections', () => {
    expect(flattenSections([{ title: 'A', photos: [p('1'), p('2')] }, { title: null, photos: [p('3')] }]).map((x) => x.id)).toEqual(['1', '2', '3']);
  });
});
