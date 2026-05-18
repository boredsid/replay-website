export interface AccessAuthEnv {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  ENVIRONMENT: string;
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: string };

let cachedKeys: { fetchedAt: number; teamDomain: string; keys: Map<string, CryptoKey> } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000; // 1 hour

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  if (cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < KEY_TTL_MS) {
    return cachedKeys.keys;
  }
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  const data = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of data.keys) {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  cachedKeys = { fetchedAt: Date.now(), teamDomain, keys };
  return keys;
}

export async function verifyAccessJwt(token: string, env: AccessAuthEnv): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg: string; kid: string };
  let payload: { iss: string; aud: string | string[]; email: string; exp: number };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: 'bad alg' };

  const keys = await loadKeys(env.CF_ACCESS_TEAM_DOMAIN);
  let key = keys.get(header.kid);
  if (!key) {
    cachedKeys = null;
    const refreshed = await loadKeys(env.CF_ACCESS_TEAM_DOMAIN);
    key = refreshed.get(header.kid);
    if (!key) return { ok: false, reason: 'unknown kid' };
  }

  const sigValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!sigValid) return { ok: false, reason: 'bad signature' };

  const expectedIss = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  if (payload.iss !== expectedIss) return { ok: false, reason: 'bad iss' };

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(env.CF_ACCESS_AUD)) return { ok: false, reason: 'bad aud' };

  if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  const email = (payload.email || '').toLowerCase();
  const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) return { ok: false, reason: 'email not allowed' };

  return { ok: true, email };
}
