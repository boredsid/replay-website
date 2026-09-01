// Web Push, implemented against WebCrypto.
//
// The Node `web-push` library does not run in Workers, so both halves of the
// protocol are here: payload encryption (RFC 8291, on top of the aes128gcm
// content encoding in RFC 8188) and VAPID request authorisation (RFC 8292).
//
// This is the one place in the codebase where writing the crypto ourselves is
// the right call, and also the one place where a silent mistake produces
// notifications that simply never arrive — no error, no bounce, just nothing.
// Correctness is proved by decrypting our own output with the subscriber key
// from RFC 8291 Appendix A — see the round-trip test.

const encoder = new TextEncoder();

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

/**
 * HKDF as RFC 8188 uses it: one extract, one 32-byte expand round.
 *
 * Only a single round is ever needed because every output here is at most 32
 * bytes, so the counter is always 0x01.
 */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/** An uncompressed P-256 point (0x04 ‖ X ‖ Y) as a JWK WebCrypto will import. */
function publicKeyToJwk(raw: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(raw.slice(1, 33)),
    y: bytesToBase64Url(raw.slice(33, 65)),
    ext: true,
  };
}

export interface KeyPairRaw {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
}

async function generateKeyPair(): Promise<KeyPairRaw> {
  // `generateKey` is typed as possibly returning a single key, which it never
  // does for ECDH; the cast keeps that narrowing local rather than loosening the
  // exported types.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  ) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { publicKey, privateKey: pair.privateKey };
}

export interface PushSubscriptionKeys {
  /** The subscriber's public key, base64url, from the browser. */
  p256dh: string;
  /** The subscriber's auth secret, base64url, from the browser. */
  auth: string;
}

/**
 * Encrypts a payload for one subscriber.
 *
 * `ephemeral` and `salt` are injectable only so a test can pin them to the RFC's
 * values; production always uses fresh random ones, and reusing either across
 * messages would be a genuine break rather than an inefficiency.
 */
export async function encryptPayload(
  payload: string,
  keys: PushSubscriptionKeys,
  ephemeral?: KeyPairRaw,
  salt?: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = base64UrlToBytes(keys.p256dh);
  const authSecret = base64UrlToBytes(keys.auth);
  const as = ephemeral ?? await generateKeyPair();
  const recordSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey('jwk', publicKeyToJwk(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // The Workers type definitions call this field `$public`, but the runtime — and
  // the WebCrypto spec — use `public`. Casting keeps the correct runtime shape.
  const ecdhAlgorithm = { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhAlgorithm, as.privateKey, 256),
  );

  // RFC 8291 §3.1: the auth secret salts the shared secret, and both public
  // keys go into the info so a message cannot be replayed at another subscriber.
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, as.publicKey);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const cek = await hkdf(recordSalt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(recordSalt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 is the delimiter marking the final record; a single record is all we
  // ever send, since the payloads here are far below the 4096-byte limit.
  const padded = concat(encoder.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded),
  );

  // RFC 8188 §2.1 header: salt ‖ record size ‖ key id length ‖ key id.
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return concat(recordSalt, recordSize, new Uint8Array([as.publicKey.length]), as.publicKey, ciphertext);
}

/** Signs a VAPID JWT for one push endpoint's origin (RFC 8292). */
export async function vapidHeaders(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const audience = new URL(endpoint).origin;
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  // Twelve hours: long enough that clock skew is irrelevant, short enough that a
  // leaked token is not useful for long. Push services reject 24h+.
  const claims = { aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject };
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = encoder.encode(`${header}.${body}`);

  const raw = base64UrlToBytes(publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...publicKeyToJwk(raw), d: privateKey },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput),
  );

  return {
    Authorization: `vapid t=${header}.${body}.${bytesToBase64Url(signature)}, k=${publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
  };
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: the push service can use to reach the sender. */
  subject: string;
}

export type PushOutcome =
  | { ok: true }
  /** The subscription is dead. Prune it rather than retrying forever. */
  | { ok: false; gone: true; status: number }
  | { ok: false; gone: false; status: number };

/**
 * Delivers one notification.
 *
 * A 404 or 410 means the subscription no longer exists — the browser was
 * uninstalled, the user cleared site data, the endpoint rotated. Those must be
 * pruned; retrying them forever is how a sending loop slowly becomes all dead
 * endpoints.
 */
export async function sendPush(
  target: PushTarget,
  payload: string,
  config: PushConfig,
  ttlSeconds = 3600,
): Promise<PushOutcome> {
  try {
    const body = await encryptPayload(payload, { p256dh: target.p256dh, auth: target.auth });
    const headers = await vapidHeaders(target.endpoint, config.publicKey, config.privateKey, config.subject);
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: { ...headers, TTL: String(ttlSeconds) },
      body,
    });
    if (response.ok) return { ok: true };
    return { ok: false, gone: response.status === 404 || response.status === 410, status: response.status };
  } catch {
    // A network failure is not evidence the subscription is dead.
    return { ok: false, gone: false, status: 0 };
  }
}
