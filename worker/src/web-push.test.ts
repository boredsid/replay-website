import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  encryptPayload,
  sendPush,
  vapidHeaders,
  type KeyPairRaw,
} from './web-push';

/**
 * Key material from the worked example in RFC 8291 Appendix A.
 *
 * Correctness is checked by decrypting with the subscriber's private key rather
 * than by comparing against a copied ciphertext string — a copied string only
 * proves the copy was accurate, while a round trip exercises every step of the
 * derivation. That matters more than usual here: a mistake would produce a
 * perfectly well-formed message no browser can decrypt, and push services accept
 * those with a 201, so nothing in production would ever report a problem.
 */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  /** The subscriber's private key, so a test can decrypt as a browser would. */
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
};

/**
 * Decrypts exactly as a browser does, using the RFC's subscriber private key.
 *
 * This is the real proof. Comparing against a copied ciphertext string only
 * shows the string was copied correctly; recovering the plaintext with the other
 * half of the key pair exercises every step of the derivation independently.
 */
async function decryptAsSubscriber(body: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);

  const uaPublicRaw = base64UrlToBytes(RFC.uaPublic);
  const uaPrivate = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      x: bytesToBase64Url(uaPublicRaw.slice(1, 33)),
      y: bytesToBase64Url(uaPublicRaw.slice(33, 65)),
      d: RFC.uaPrivate, ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
  );
  const asKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      x: bytesToBase64Url(asPublic.slice(1, 33)),
      y: bytesToBase64Url(asPublic.slice(33, 65)),
      ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );

  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const enc = new TextEncoder();
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const mac = async (key: Uint8Array, data: Uint8Array) => new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    data,
  ));
  const kdf = async (salt2: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) =>
    (await mac(await mac(salt2, ikm), cat(info, new Uint8Array([1])))).slice(0, length);

  const ikm = await kdf(
    base64UrlToBytes(RFC.authSecret), shared,
    cat(enc.encode('WebPush: info\0'), uaPublicRaw, asPublic), 32,
  );
  const cek = await kdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await kdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']),
    ciphertext,
  ));
  // Strip the 0x02 final-record delimiter.
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function rfcEphemeralKey(): Promise<KeyPairRaw> {
  const raw = base64UrlToBytes(RFC.asPublic);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      x: bytesToBase64Url(raw.slice(1, 33)),
      y: bytesToBase64Url(raw.slice(33, 65)),
      d: RFC.asPrivate,
      ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  return { publicKey: raw, privateKey };
}

afterEach(() => vi.unstubAllGlobals());

describe('base64url', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128]);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it('uses the url-safe alphabet and no padding', () => {
    const encoded = bytesToBase64Url(new Uint8Array([251, 255, 190]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('decodes a value that needs padding restored', () => {
    // The auth secret is 16 bytes, which encodes to 22 characters plus padding.
    expect(base64UrlToBytes(RFC.authSecret)).toHaveLength(16);
  });
});

describe('encryptPayload against RFC 8291 Appendix A', () => {
  it('produces something the subscriber can actually decrypt', async () => {
    const body = await encryptPayload(
      RFC.plaintext,
      { p256dh: RFC.uaPublic, auth: RFC.authSecret },
      await rfcEphemeralKey(),
      base64UrlToBytes(RFC.salt),
    );

    // If any step of the derivation were wrong this would throw or return
    // rubbish -- and a push service would still have accepted the message with a
    // 201, so nothing in production would ever have reported it.
    expect(await decryptAsSubscriber(body)).toBe(RFC.plaintext);
  });

  it('is decryptable with fresh random keys too, not only the RFC ones', async () => {
    const body = await encryptPayload('a later message', { p256dh: RFC.uaPublic, auth: RFC.authSecret });
    expect(await decryptAsSubscriber(body)).toBe('a later message');
  });

  it('builds the aes128gcm header the way RFC 8188 specifies', async () => {
    const body = await encryptPayload(
      RFC.plaintext,
      { p256dh: RFC.uaPublic, auth: RFC.authSecret },
      await rfcEphemeralKey(),
      base64UrlToBytes(RFC.salt),
    );

    expect(body.slice(0, 16)).toEqual(base64UrlToBytes(RFC.salt));
    // Record size 4096, big endian.
    expect([...body.slice(16, 20)]).toEqual([0, 0, 16, 0]);
    // Key id is the sender's uncompressed public point: 65 bytes.
    expect(body[20]).toBe(65);
    expect(bytesToBase64Url(body.slice(21, 86))).toBe(RFC.asPublic);
  });

  it('produces a different body every time in production', async () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.authSecret };
    const a = await encryptPayload('hello', keys);
    const b = await encryptPayload('hello', keys);
    // Reusing a salt or ephemeral key across messages would be a real break,
    // not merely wasteful.
    expect(bytesToBase64Url(a)).not.toBe(bytesToBase64Url(b));
  });
});

const VAPID = {
  publicKey: RFC.asPublic,
  privateKey: RFC.asPrivate,
  subject: 'mailto:hello@replaycon.in',
};

describe('vapidHeaders', () => {
  it('signs a JWT scoped to the push service origin, not the full endpoint', async () => {
    const headers = await vapidHeaders(
      'https://fcm.googleapis.com/fcm/send/abc123',
      VAPID.publicKey, VAPID.privateKey, VAPID.subject,
      Date.UTC(2026, 8, 12, 9, 0, 0),
    );
    const token = headers.Authorization.match(/t=([^,]+)/)![1];
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split('.')[1])));

    // A token scoped to the whole path would leak which subscriber it was for.
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe(VAPID.subject);
  });

  it('expires twelve hours out, which push services accept', async () => {
    const now = Date.UTC(2026, 8, 12, 9, 0, 0);
    const headers = await vapidHeaders('https://push.example/x', VAPID.publicKey, VAPID.privateKey, VAPID.subject, now);
    const token = headers.Authorization.match(/t=([^,]+)/)![1];
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split('.')[1])));

    expect(claims.exp - Math.floor(now / 1000)).toBe(12 * 60 * 60);
  });

  it('declares ES256 and carries the public key alongside', async () => {
    const headers = await vapidHeaders('https://push.example/x', VAPID.publicKey, VAPID.privateKey, VAPID.subject);
    const token = headers.Authorization.match(/t=([^,]+)/)![1];
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split('.')[0])));

    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(headers.Authorization).toContain(`k=${VAPID.publicKey}`);
    expect(headers['Content-Encoding']).toBe('aes128gcm');
  });

  it('produces a signature that verifies against the public key', async () => {
    const headers = await vapidHeaders('https://push.example/x', VAPID.publicKey, VAPID.privateKey, VAPID.subject);
    const [h, b, sig] = headers.Authorization.match(/t=([^,]+)/)![1].split('.');
    const raw = base64UrlToBytes(VAPID.publicKey);
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: bytesToBase64Url(raw.slice(1, 33)), y: bytesToBase64Url(raw.slice(33, 65)), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key,
      base64UrlToBytes(sig), new TextEncoder().encode(`${h}.${b}`),
    );
    expect(valid).toBe(true);
  });
});

describe('sendPush', () => {
  const target = { endpoint: 'https://push.example/x', p256dh: RFC.uaPublic, auth: RFC.authSecret };

  it('reports success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));
    expect(await sendPush(target, 'hi', VAPID)).toEqual({ ok: true });
  });

  it.each([404, 410])('treats %i as a dead subscription to prune', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    expect(await sendPush(target, 'hi', VAPID)).toEqual({ ok: false, gone: true, status });
  });

  it.each([429, 500, 503])('does not prune on a %i, which is the service having a moment', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    expect(await sendPush(target, 'hi', VAPID)).toMatchObject({ gone: false });
  });

  it('does not prune on a network failure either', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    // Losing every subscription during a blip would be far worse than the blip.
    expect(await sendPush(target, 'hi', VAPID)).toEqual({ ok: false, gone: false, status: 0 });
  });

  it('sends the encrypted body with a TTL', async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(null, { status: 201 });
    }));

    await sendPush(target, 'hi', VAPID, 600);

    const headers = seen!.headers as Record<string, string>;
    expect(headers.TTL).toBe('600');
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect((seen!.body as Uint8Array).byteLength).toBeGreaterThan(86);
  });
});
