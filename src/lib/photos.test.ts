import { afterEach, describe, expect, it, vi } from 'vitest';
import { albumCards, albumHost, coverAtSize, imageSize, imagesInOrder, isLandscape, readOpenGraph } from './photos';
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

// A JPEG header with just enough segments for imageSize: SOI, an APP0 block, then SOF0.
function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0,
  ]);
}

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

describe('imageSize and isLandscape', () => {
  it('reads a JPEG and a PNG header, and nothing else', () => {
    expect(imageSize(jpeg(200, 112))).toEqual({ width: 200, height: 112 });
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('calls a photo landscape only when it is clearly wider than tall', () => {
    expect(isLandscape({ width: 200, height: 112 })).toBe(true);
    expect(isLandscape({ width: 200, height: 190 })).toBe(false);
    expect(isLandscape({ width: 112, height: 200 })).toBe(false);
    expect(isLandscape(null)).toBe(false);
  });
});

describe('imagesInOrder', () => {
  it('keeps gallery order across sections and leaves videos out', () => {
    const photo = (id: string, kind: 'image' | 'video' = 'image') => ({ id, kind });
    expect(imagesInOrder([{ photos: [photo('v1', 'video'), photo('p1')] }, { photos: [photo('p2')] }]).map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('fetchAlbumCover', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const WORKER = 'https://api.replaycon.in';
  const image = (body: BodyInit = 'jpeg-bytes') => new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });

  /** Routes each request the way the real services would answer it. */
  function services(routes: Array<[RegExp, () => Response]>) {
    return vi.fn(async (input: string) => {
      const route = routes.find(([pattern]) => pattern.test(input));
      if (!route) throw new Error(`unexpected fetch ${input}`);
      return route[1]();
    });
  }

  it('follows a Google Photos link, identifying itself, and returns the large cover', async () => {
    const fetchMock = services([
      [/^https:\/\/photos\.app\.goo\.gl\//, () => new Response('<meta property="og:image" content="https://lh3.googleusercontent.com/pw/c=w600-h315-p-k">')],
      [/^https:\/\/lh3\.googleusercontent\.com\//, () => image()],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAlbumCover('https://photos.app.goo.gl/2oKWtdKCofYAGhUa6', 'gp-cover', WORKER)).toBe('https://lh3.googleusercontent.com/pw/c=w1600-h900-p-k-no');
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^REPLAY-site-build/);
  });

  const gallery = (ids: Array<[string, 'image' | 'video']>) => new Response(JSON.stringify({
    source: 'google_drive',
    albumUrl: 'x',
    complete: true,
    sections: [{ title: 'Amrit', photos: ids.map(([id, kind]) => ({ id, kind })) }],
  }));

  it("covers a Drive album with its first landscape photo, through the Worker's image proxy", async () => {
    const sizes: Record<string, [number, number]> = { portraitAAAA: [112, 200], landscapeBBB: [200, 112], landscapeCCC: [200, 112] };
    const fetchMock = vi.fn(async (input: string) => {
      const thumb = input.match(/thumbnail\?id=([^&]+)/);
      if (thumb) return image(jpeg(...sizes[thumb[1]]));
      if (/\/api\/photos\/replay-2$/.test(input)) return gallery([['videoXXXXXXX', 'video'], ['portraitAAAA', 'image'], ['landscapeBBB', 'image'], ['landscapeCCC', 'image']]);
      return image();
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAlbumCover('https://drive.google.com/drive/folders/1LandscapeXY', 'replay-2', WORKER)).toBe('https://api.replaycon.in/api/photos/image/drive/landscapeBBB');
    // The video is never measured, and nothing after the first landscape photo is.
    const measured = fetchMock.mock.calls.map((c) => String(c[0]).match(/thumbnail\?id=([^&]+)/)?.[1]).filter(Boolean);
    expect(measured).toEqual(['portraitAAAA', 'landscapeBBB']);
  });

  it('settles for the first photo when none of them is landscape', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (/\/api\/photos\/replay-1$/.test(input)) return gallery([['portraitAAAA', 'image'], ['portraitBBBB', 'image']]);
      if (/thumbnail/.test(input)) return image(jpeg(112, 200));
      return image();
    }));
    expect(await fetchAlbumCover('https://drive.google.com/drive/folders/1AllPortrait', 'replay-1', WORKER)).toBe('https://api.replaycon.in/api/photos/image/drive/portraitAAAA');
  });

  it('asks only once per album in a build', async () => {
    const fetchMock = vi.fn(async (input: string) => (/\/api\/photos\/replay-once$/.test(input) ? gallery([['photoCCCCCCC', 'image']]) : image(jpeg(200, 112))));
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://drive.google.com/drive/folders/1OnceOnlyXYZ';
    await fetchAlbumCover(url, 'replay-once', WORKER);
    const calls = fetchMock.mock.calls.length;
    await fetchAlbumCover(url, 'replay-once', WORKER);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('never hands Astro a cover that is not an image right now', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (/goo\.gl/.test(input)) return new Response('<meta property="og:image" content="https://lh3.googleusercontent.com/pw/c=w600">');
      return new Response('<html>nope</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }));
    expect(await fetchAlbumCover('https://photos.app.goo.gl/notAnImage', 'gp-html', WORKER)).toBeNull();
  });

  it('gives up quietly when an album cannot be read, or the network is down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    expect(await fetchAlbumCover('https://photos.app.goo.gl/x', 'gp-gone', WORKER)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"drive_not_configured"}', { status: 503 })));
    expect(await fetchAlbumCover('https://drive.google.com/drive/folders/1NoKeyXYZabc', 'drive-no-key', WORKER)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchAlbumCover('https://photos.app.goo.gl/y', 'gp-offline', WORKER)).toBeNull();
  });

  it('has no cover for a link that is not an album', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAlbumCover('https://flickr.com/x', 'elsewhere', WORKER)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
