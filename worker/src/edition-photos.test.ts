import { afterEach, describe, expect, it, vi } from 'vitest';
import { albumSource, buildGallery, buildPhotoImage, driveSections, type DriveFile } from './edition-photos';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ALBUM_KEY = 'AF1QipPk40ln8lzMiqql3QK9-Pg0kzl8NZT_atf6M5mwahad13';
const AUTH_KEY = 'dEVwMHhoRnlneWdVTzlCeWRTZjVDa0k3QWlqNnRR';
const TOKEN_A = 'AP1GczOoi8SGudg1gPQuNajLa9kImwVpU8S29QuKfi42';
const TOKEN_B = 'AP1GczOEp_50-4yoId_tn8nsgzaLpQVQNPewtSRitQGU';
const SHORT = 'https://photos.app.goo.gl/2oKWtdKCofYAGhUa6';
const FOLDER = '1nVoh6VwZReJZ4QKkSUl5HONKuFpcxLnK';

// A shared-album entry shaped like Google's, as in google-photos.test.ts.
function item(mediaKey: string, token: string, video = false): unknown[] {
  return [
    mediaKey,
    [`https://lh3.googleusercontent.com/pw/${token}`, 4080, 3072],
    1768093198748,
    'dedupKey',
    video ? { '15': 1, '76647426': [8123, 1920, 1080] } : { '15': 1 },
  ];
}

function sharePage(items: unknown[]): string {
  const data = JSON.stringify([null, items, '', [ALBUM_KEY, 'REPLAY 3E'], null, 0]);
  return `<html><script nonce="n">AF_initDataCallback({key: 'ds:1', hash: '2', data:${data}, sideChannel: {}});</script></html>`;
}

/** A Response whose `url` is where the short link landed. */
function landed(body: string, url: string): Response {
  const res = new Response(body, { status: 200 });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

function editions(row: Record<string, unknown> | null, error: unknown = null) {
  const chain: any = {};
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: row, error }));
  return { from: vi.fn(() => chain) } as any;
}

const REPLAY_3 = { slug: 'replay-3', photos_url: SHORT, is_published: true };
const REPLAY_2 = { slug: 'replay-2', photos_url: `https://drive.google.com/drive/folders/${FOLDER}?usp=drive_link`, is_published: true };

describe('albumSource', () => {
  it('reads both Google Photos link forms and a Drive folder', () => {
    expect(albumSource(SHORT)).toEqual({ kind: 'google_photos', url: SHORT });
    expect(albumSource(`https://photos.google.com/share/${ALBUM_KEY}?key=${AUTH_KEY}`)?.kind).toBe('google_photos');
    expect(albumSource(REPLAY_2.photos_url)).toEqual({ kind: 'google_drive', folderId: FOLDER });
    expect(albumSource(`https://drive.google.com/drive/u/0/folders/${FOLDER}`)).toEqual({ kind: 'google_drive', folderId: FOLDER });
  });

  it('refuses anything it could not read without signing in', () => {
    expect(albumSource(`https://photos.google.com/album/${ALBUM_KEY}`)).toBeNull();
    expect(albumSource(`https://drive.google.com/file/d/${FOLDER}/view`)).toBeNull();
    expect(albumSource('https://drive.google.com.evil.example/drive/folders/1234567890')).toBeNull();
    expect(albumSource(null)).toBeNull();
  });
});

describe('buildGallery — Google Photos', () => {
  it('lists the album as one section, with grid, lightbox, download and view addresses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      landed(sharePage([item('AF1QipA', TOKEN_A), item('AF1QipB', TOKEN_B, true)]), `https://photos.google.com/share/${ALBUM_KEY}?key=${AUTH_KEY}`)));
    const res = await buildGallery(editions(REPLAY_3), {}, 'replay-3');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ source: 'google_photos', albumUrl: SHORT, complete: true });
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].title).toBeNull();
    const [photo, video] = body.sections[0].photos;
    expect(photo).toEqual({
      id: TOKEN_A,
      name: 'replay-3e-1.jpg',
      kind: 'image',
      thumbUrl: `https://lh3.googleusercontent.com/pw/${TOKEN_A}=w480-h480-c`,
      fullUrl: `https://lh3.googleusercontent.com/pw/${TOKEN_A}=w1600-h1600`,
      viewUrl: `https://photos.google.com/share/${ALBUM_KEY}/photo/AF1QipA?key=${AUTH_KEY}`,
      downloadUrl: `https://lh3.googleusercontent.com/pw/${TOKEN_A}=d`,
    });
    expect(video).toMatchObject({ kind: 'video', name: 'replay-3e-2.mp4', downloadUrl: `https://lh3.googleusercontent.com/pw/${TOKEN_B}=dv` });
  });

  it('answers with the album link when Google no longer serves a readable page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => landed('<html>sign in</html>', `https://photos.google.com/share/${ALBUM_KEY}?key=${AUTH_KEY}`)));
    const res = await buildGallery(editions(REPLAY_3), {}, 'replay-3');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'unreadable_album', albumUrl: SHORT });
  });
});

describe('buildGallery — Google Drive', () => {
  const file = (id: string, name: string, mimeType: string): DriveFile => ({ id, name, mimeType });
  const AMRIT = 'amritFolder1234';
  const KYU = 'kyuFolder123456';

  function driveApi(listings: Record<string, DriveFile[]>) {
    return vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.hostname).toBe('www.googleapis.com');
      expect(url.searchParams.get('key')).toBe('drive-key');
      const parent = url.searchParams.get('q')!.match(/^'([^']+)' in parents/)![1];
      return new Response(JSON.stringify({ files: listings[parent] ?? [] }), { status: 200 });
    });
  }

  it('reads one level of photographer subfolders into named sections', async () => {
    const fetchMock = driveApi({
      [FOLDER]: [
        file(KYU, 'The Kyu Co', 'application/vnd.google-apps.folder'),
        file(AMRIT, 'Amrit', 'application/vnd.google-apps.folder'),
        file('looseImage123', 'group.jpg', 'image/jpeg'),
        file('notes123456789', 'credits.pdf', 'application/pdf'),
      ],
      [AMRIT]: [file('amritPhoto0001', 'IMG_0001.jpg', 'image/jpeg'), file('amritClip00001', 'clip.mp4', 'video/mp4')],
      [KYU]: [file('kyuPhoto000001', 'quiz.jpg', 'image/jpeg')],
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await buildGallery(editions(REPLAY_2), { DRIVE_API_KEY: 'drive-key' }, 'replay-2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('google_drive');
    expect(body.sections.map((s: any) => [s.title, s.photos.map((p: any) => p.name)])).toEqual([
      [null, ['group.jpg']],
      ['Amrit', ['IMG_0001.jpg', 'clip.mp4']],
      ['The Kyu Co', ['quiz.jpg']],
    ]);
    expect(body.sections[1].photos[0]).toEqual({
      id: 'amritPhoto0001',
      name: 'IMG_0001.jpg',
      kind: 'image',
      thumbUrl: 'https://drive.google.com/thumbnail?id=amritPhoto0001&sz=w480',
      fullUrl: 'https://drive.google.com/thumbnail?id=amritPhoto0001&sz=w1600',
      viewUrl: 'https://drive.google.com/file/d/amritPhoto0001/view',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=amritPhoto0001',
    });
    expect(body.sections[1].photos[1].kind).toBe('video');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('links out to Drive when the Worker has no Drive key, without calling Google', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await buildGallery(editions(REPLAY_2), {}, 'replay-2');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'drive_not_configured', albumUrl: REPLAY_2.photos_url });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('links out when Drive refuses the listing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await buildGallery(editions(REPLAY_2), { DRIVE_API_KEY: 'drive-key' }, 'replay-2');
    expect(res.status).toBe(502);
    expect((await res.json()).albumUrl).toBe(REPLAY_2.photos_url);
  });

  it('drops empty subfolders and anything that is not a photo or video', () => {
    expect(driveSections([], [{ name: 'Empty', files: [] }, { name: 'Docs', files: [{ id: 'x1234567890', name: 'a.pdf', mimeType: 'application/pdf' }] }])).toEqual([]);
  });
});

describe('buildGallery — who can see what', () => {
  it('has nothing for an unpublished edition, one without an album, or a slug that could not be one', async () => {
    expect((await buildGallery(editions({ ...REPLAY_3, is_published: false }), {}, 'replay-3')).status).toBe(404);
    expect((await buildGallery(editions({ ...REPLAY_3, photos_url: null }), {}, 'replay-3')).status).toBe(404);
    expect((await buildGallery(editions(null), {}, 'replay-9')).status).toBe(404);
    const sb = editions(REPLAY_3);
    expect((await buildGallery(sb, {}, 'replay 3; drop')).status).toBe(404);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('answers with the link for an album address it cannot read', async () => {
    const res = await buildGallery(editions({ ...REPLAY_3, photos_url: `https://photos.google.com/album/${ALBUM_KEY}` }), {}, 'replay-3');
    expect(res.status).toBe(502);
    expect((await res.json()).albumUrl).toContain('/album/');
  });
});

describe('buildPhotoImage', () => {
  it('fetches only a shared-album photo or a Drive thumbnail, at lightbox size, readable cross-origin', async () => {
    const fetchMock = vi.fn(async () => new Response('jpeg-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    const google = await buildPhotoImage('google', TOKEN_A);
    expect(google.status).toBe(200);
    expect(google.headers.get('Content-Type')).toBe('image/jpeg');
    expect(google.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(`https://lh3.googleusercontent.com/pw/${TOKEN_A}=w1600-h1600`);

    await buildPhotoImage('drive', 'amritPhoto0001');
    expect(fetchMock).toHaveBeenLastCalledWith('https://drive.google.com/thumbnail?id=amritPhoto0001&sz=w1600');
  });

  it('refuses anything that could change the upstream address', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const [source, id] of [['google', 'short'], ['google', '../../etc'], ['drive', 'a/b'], ['flickr', TOKEN_A]]) {
      expect((await buildPhotoImage(source, id)).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not pass on something that is not an image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })));
    expect((await buildPhotoImage('google', TOKEN_A)).status).toBe(404);
  });
});
