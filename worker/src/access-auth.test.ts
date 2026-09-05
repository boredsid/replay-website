import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { verifyAccessJwt, type AccessAuthEnv } from './access-auth';

// Helper: build an Env shape for tests
const baseEnv = (): AccessAuthEnv => ({
  CF_ACCESS_TEAM_DOMAIN: 'boardgamecompany.cloudflareaccess.com',
  CF_ACCESS_AUD: 'test-aud-tag',
  ENVIRONMENT: 'production',
});

// We'll mock fetch to return the Cloudflare JWKS endpoint.
// For tests we use a static JWK pair generated via crypto.subtle.

async function generateTestKey() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { keyPair, jwk: { ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' } };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-kid' };
  const enc = new TextEncoder();
  const headerB64 = b64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

describe('verifyAccessJwt', () => {
  let keyPair: CryptoKeyPair;
  let jwk: JsonWebKey & { kid: string };

  // Generated once for the whole file, not per test.
  //
  // `access-auth` caches the fetched JWKS in a module-level variable keyed by
  // team domain, and every token here uses the same `kid`, so a fresh keypair
  // each test meant the cache kept serving the *first* test's public key while
  // later tests signed with a different private one. Every signature then
  // failed, and every "rejects when ..." test passed without once exercising
  // the condition it names.
  beforeAll(async () => {
    const k = await generateTestKey();
    keyPair = k.keyPair;
    jwk = k.jwk as JsonWebKey & { kid: string };
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/cdn-cgi/access/certs')) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  it('accepts a valid JWT and returns the email', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe('a@x.com');
  });

  it('rejects when audience does not match', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'wrong-aud',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects when issuer does not match', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://evil.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects when expired', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('authenticates anybody Cloudflare vouched for, allowlist or not', async () => {
    // This function answers "is this a real Access token, and whose". Whether
    // that person may do anything is the `staff` table's question now -- it
    // used to be answered here against ADMIN_EMAILS, which is why adding a
    // volunteer needed a Worker deploy.
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'stranger@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result).toEqual({ ok: true, email: 'stranger@x.com' });
  });

  it('rejects a token carrying no email', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect((await verifyAccessJwt(token, baseEnv())).ok).toBe(false);
  });

  it('rejects a signature from the wrong key', async () => {
    // The property the whole file rested on and never actually checked.
    const other = await generateTestKey();
    const token = await signJwt(other.keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect((await verifyAccessJwt(token, baseEnv())).ok).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    const result = await verifyAccessJwt('not-a-jwt', baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects empty/missing tokens', async () => {
    const result = await verifyAccessJwt('', baseEnv());
    expect(result.ok).toBe(false);
  });
});
