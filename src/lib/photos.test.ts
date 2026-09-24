import { afterEach, describe, expect, it, vi } from 'vitest';
import { albumCards, albumHost, coverAtSize, readOpenGraph } from './photos';
import { fetchAlbumCover } from './album-cover';

describe('albumHost', () => {
  it('recognises both Google Photos link forms and a Drive folder', () => {
    expect(albumHost('https://photos.app.goo.gl/2oKWtdKCofYAGhUa6')).toBe('google-photos');
    expect(albumHost('https://photos.google.com/share/AF1QipAbc?key=xyz')).toBe('google-photos');
    expect(albumHost('https://drive.google.com/drive/folders/1AbC?usp=sharing')).toBe('google-drive');
  });

  it('refuses anything else, including look-alikes and plain http', () => {
    for (const url of ['http://photos.app.goo.gl/x', 'https://photos.google.com.evil.example/x', 'https://flickr.com/x', 'not a url', '', null, undefined]) {
      expect(albumHost(url as string)).toBeNull();
    }
  });
});

describe('readOpenGraph', () => {
  // A synthetic page, shaped like an album's head; no copy of Google's markup.
  const html = `<html><head>
    <meta property="og:title" content="REPLAY convention Sep 2026 &amp; friends">
    <meta content="https://lh3.googleusercontent.com/pw/AP1Gcz-cover=w600-h315-p-k" property="og:image">
    <meta property="og:description" content="Shared album">
  </head></html>`;

  it('reads the cover and title in either attribute order, and decodes entities', () => {
    expect(readOpenGraph(html)).toEqual({
      title: 'REPLAY convention Sep 2026 & friends',
      image: 'https://lh3.googleusercontent.com/pw/AP1Gcz-cover=w600-h315-p-k',
    });
  });

  it('returns nothing from a page without the tags', () => {
    expect(readOpenGraph('<html><head><title>Sign in</title></head></html>')).toEqual({ image: undefined, title: undefined });
  });
});

describe('coverAtSize', () => {
  it('asks Google for the cover at the size the card shows', () => {
    expect(coverAtSize('https://lh3.googleusercontent.com/pw/AP1Gcz-cover=w600-h315-p-k', 1600, 900))
      .toBe('https://lh3.googleusercontent.com/pw/AP1Gcz-cover=w1600-h900-p-k-no');
  });

  it('adds a size to an address that has none', () => {
    expect(coverAtSize('https://lh3.googleusercontent.com/pw/AP1Gcz-cover', 1600, 900))
      .toBe('https://lh3.googleusercontent.com/pw/AP1Gcz-cover=w1600-h900-p-k-no');
  });

  it('will not rewrite an address from anywhere else', () => {
    expect(coverAtSize('https://ssl.gstatic.com/drive/logo=w600', 1600, 900)).toBeNull();
    expect(coverAtSize('http://lh3.googleusercontent.com/pw/x=w600', 1600, 900)).toBeNull();
    expect(coverAtSize(undefined, 1600, 900)).toBeNull();
  });
});

describe('albumCards', () => {
  const ed = (slug: string, end_date: string, photos_url: string | null) => ({ slug, start_date: end_date, end_date, photos_url });
  const R1 = ed('replay-1', '2026-01-31', 'https://photos.app.goo.gl/one');
  const R2 = ed('replay-2', '2026-04-19', null);
  const R3 = ed('replay-3', '2026-09-13', 'https://photos.app.goo.gl/2oKWtdKCofYAGhUa6');

  it('lists editions with an album, newest first', () => {
    expect(albumCards([R1, R2, R3], 'replay-3')).toEqual({ albums: [R3, R1], awaiting: null });
  });

  it('opens with the latest edition when its album has not been added yet', () => {
    const R3Pending = { ...R3, photos_url: null };
    expect(albumCards([R1, R3Pending], 'replay-3')).toEqual({ albums: [R1], awaiting: R3Pending });
  });

  it('has nothing to show on a site with no albums', () => {
    expect(albumCards([R2], 'replay-2')).toEqual({ albums: [], awaiting: R2 });
    expect(albumCards([], null)).toEqual({ albums: [], awaiting: null });
  });

  it('ignores a link the Worker would never have accepted', () => {
    expect(albumCards([ed('replay-2', '2026-04-19', 'https://flickr.com/x')], null).albums).toEqual([]);
  });
});

describe('fetchAlbumCover', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows a Google Photos link, identifying itself, and returns the large cover', async () => {
    const fetchMock = vi.fn(async () => new Response('<meta property="og:image" content="https://lh3.googleusercontent.com/pw/c=w600-h315-p-k">'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAlbumCover('https://photos.app.goo.gl/2oKWtdKCofYAGhUa6')).toBe('https://lh3.googleusercontent.com/pw/c=w1600-h900-p-k-no');
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^REPLAY-site-build/);
  });

  it('does not fetch a Drive folder at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAlbumCover('https://drive.google.com/drive/folders/1AbC')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up quietly when Google says no, or the network is down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    expect(await fetchAlbumCover('https://photos.app.goo.gl/x')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchAlbumCover('https://photos.app.goo.gl/x')).toBeNull();
  });
});
