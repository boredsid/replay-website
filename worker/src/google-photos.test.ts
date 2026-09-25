import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeGooglePhotosUrl,
  parseSharePage,
  parseBatchResponse,
  fetchGoogleAlbum,
  isValidMediaToken,
} from './google-photos';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALBUM_KEY = 'AF1QipPk40ln8lzMiqql3QK9-Pg0kzl8NZT_atf6M5mwahad13';
const AUTH_KEY = 'dEVwMHhoRnlneWdVTzlCeWRTZjVDa0k3QWlqNnRR';
const SHARE_URL = `https://photos.google.com/share/${ALBUM_KEY}?key=${AUTH_KEY}`;

// Shaped like a real shared-album entry, trimmed of fields the parser ignores.
function item(mediaKey: string, token: string, video = false): unknown[] {
  return [
    mediaKey,
    [`https://lh3.googleusercontent.com/pw/${token}`, 4080, 3072, null, null, null, null, null, [null, null, 1]],
    1768093198748,
    'dedupKey',
    -28800000,
    1768750524545,
    ['AF1QipOwner'],
    [[2], [31, 0, 1]],
    2,
    video ? { '15': 1472329, '76647426': [8123, 1920, 1080] } : { '15': 1472329 },
  ];
}

function albumData(items: unknown[], nextPageToken = ''): unknown[] {
  return [null, items, nextPageToken, [ALBUM_KEY, 'Demo Album'], null, 0];
}

function sharePage(items: unknown[], nextPageToken = ''): string {
  return (
    `<html><script nonce="n">AF_initDataCallback({key: 'ds:0', hash: '1', data:[null,"prefs"], sideChannel: {}});</script>` +
    `<script nonce="n">AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(albumData(items, nextPageToken))}, sideChannel: {}});</script></html>`
  );
}

function batchBody(items: unknown[], nextPageToken = ''): string {
  const payload = JSON.stringify(albumData(items, nextPageToken));
  return `)]}'\n\n1234\n${JSON.stringify([['wrb.fr', 'snAcKc', payload, null, null, null, 'generic'], ['di', 42]])}\n25\n[["e",4,null,null,1234]]\n`;
}

const TOKEN_A = 'AP1GczOoi8SGudg1gPQuNajLa9kImwVpU8S29QuKfi42';
const TOKEN_B = 'AP1GczOEp_50-4yoId_tn8nsgzaLpQVQNPewtSRitQGU';
const TOKEN_C = 'AP1GczOE7i4DfqM_vdSjSeEaed-qOAkGroOE57bqBusw';

describe('normalizeGooglePhotosUrl', () => {
  it('keeps a share short link, minus a trailing slash', () => {
    expect(normalizeGooglePhotosUrl(' https://photos.app.goo.gl/QKGRYqfdS15bj8Kr5/ ')).toBe(
      'https://photos.app.goo.gl/QKGRYqfdS15bj8Kr5',
    );
  });

  it('keeps a long share URL and drops the signed-in account prefix', () => {
    expect(normalizeGooglePhotosUrl(`https://photos.google.com/u/1/share/${ALBUM_KEY}?key=${AUTH_KEY}&pli=1`)).toBe(
      SHARE_URL,
    );
  });

  it('rejects links that cannot be read without signing in, and non-album links', () => {
    expect(normalizeGooglePhotosUrl(`https://photos.google.com/album/${ALBUM_KEY}`)).toBeNull();
    expect(normalizeGooglePhotosUrl(`https://photos.google.com/share/${ALBUM_KEY}`)).toBeNull();
    expect(normalizeGooglePhotosUrl(`https://photos.google.com/share/${ALBUM_KEY}/photo/AF1Qip?key=${AUTH_KEY}`)).toBeNull();
    expect(normalizeGooglePhotosUrl('http://photos.app.goo.gl/QKGRYqfdS15bj8Kr5')).toBeNull();
    expect(normalizeGooglePhotosUrl('https://drive.google.com/drive/folders/11e-Aibjt3IztaW')).toBeNull();
    expect(normalizeGooglePhotosUrl('not a link')).toBeNull();
  });
});

describe('parseSharePage', () => {
  it('reads the embedded items, telling videos from photos', () => {
    const page = parseSharePage(sharePage([item('AF1QipA', TOKEN_A), item('AF1QipB', TOKEN_B, true)]));
    expect(page).toEqual({
      items: [
        { mediaKey: 'AF1QipA', token: TOKEN_A, baseUrl: `https://lh3.googleusercontent.com/pw/${TOKEN_A}`, isVideo: false },
        { mediaKey: 'AF1QipB', token: TOKEN_B, baseUrl: `https://lh3.googleusercontent.com/pw/${TOKEN_B}`, isVideo: true },
      ],
      nextPageToken: null,
    });
  });

  it('returns the page token when the album continues', () => {
    expect(parseSharePage(sharePage([item('AF1QipA', TOKEN_A)], 'PAGE2'))?.nextPageToken).toBe('PAGE2');
  });

  it('skips entries whose media is not on the shared-album image host', () => {
    const odd = item('AF1QipX', TOKEN_C);
    (odd[1] as unknown[])[0] = 'https://example.com/pw/whatever';
    expect(parseSharePage(sharePage([item('AF1QipA', TOKEN_A), odd]))?.items.map((i) => i.mediaKey)).toEqual(['AF1QipA']);
  });

  it('returns null for a page with no album on it', () => {
    expect(parseSharePage('<html><body>Sign in</body></html>')).toBeNull();
    expect(parseSharePage(sharePage([]))).toBeNull();
  });
});

describe('parseBatchResponse', () => {
  it('unwraps a batchexecute page', () => {
    const page = parseBatchResponse(batchBody([item('AF1QipC', TOKEN_C)], 'PAGE3'));
    expect(page?.items.map((i) => i.mediaKey)).toEqual(['AF1QipC']);
    expect(page?.nextPageToken).toBe('PAGE3');
  });

  it('returns null for an error body', () => {
    expect(parseBatchResponse(')]}\'\n\n[["er",null,null,null,null,400]]')).toBeNull();
  });
});

function pageResponse(html: string, url = SHARE_URL) {
  return { ok: true, status: 200, url, text: async () => html };
}

function batchResponse(body: string, ok = true) {
  return { ok, status: ok ? 200 : 500, url: '', text: async () => body };
}

describe('fetchGoogleAlbum', () => {
  it('follows the short link and reads every page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageResponse(sharePage([item('AF1QipA', TOKEN_A)], 'PAGE2')))
      .mockResolvedValueOnce(batchResponse(batchBody([item('AF1QipB', TOKEN_B), item('AF1QipA', TOKEN_A)], 'PAGE3')))
      .mockResolvedValueOnce(batchResponse(batchBody([item('AF1QipC', TOKEN_C)])));
    vi.stubGlobal('fetch', fetchMock);

    const album = await fetchGoogleAlbum('https://photos.app.goo.gl/QKGRYqfdS15bj8Kr5');
    expect(album?.albumKey).toBe(ALBUM_KEY);
    expect(album?.authKey).toBe(AUTH_KEY);
    expect(album?.complete).toBe(true);
    // The repeat of A on page 2 is dropped.
    expect(album?.items.map((i) => i.mediaKey)).toEqual(['AF1QipA', 'AF1QipB', 'AF1QipC']);

    const [pageUrl, init] = fetchMock.mock.calls[1];
    expect(String(pageUrl)).toContain('rpcids=snAcKc');
    const freq = JSON.parse(new URLSearchParams(init.body).get('f.req')!);
    expect(JSON.parse(freq[0][0][1])).toEqual([ALBUM_KEY, 'PAGE2', null, AUTH_KEY]);
  });

  it('keeps what it read when a later page fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(pageResponse(sharePage([item('AF1QipA', TOKEN_A)], 'PAGE2')))
        .mockResolvedValueOnce(batchResponse('', false)),
    );
    const album = await fetchGoogleAlbum(SHARE_URL);
    expect(album?.items).toHaveLength(1);
    expect(album?.complete).toBe(false);
  });

  it('returns null when the album is gone or no longer shared', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, url: SHARE_URL, text: async () => '' }));
    expect(await fetchGoogleAlbum(SHARE_URL)).toBeNull();
  });

  it('returns null when the link lands somewhere other than a share page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(pageResponse(sharePage([item('AF1QipA', TOKEN_A)]), 'https://accounts.google.com/signin')),
    );
    expect(await fetchGoogleAlbum('https://photos.app.goo.gl/QKGRYqfdS15bj8Kr5')).toBeNull();
  });
});

describe('isValidMediaToken', () => {
  it('accepts lh3 tokens and rejects anything that could change the path', () => {
    expect(isValidMediaToken(TOKEN_A)).toBe(true);
    expect(isValidMediaToken('short')).toBe(false);
    expect(isValidMediaToken(`${TOKEN_A}/../x`)).toBe(false);
    expect(isValidMediaToken(`${TOKEN_A}=d`)).toBe(false);
  });
});
