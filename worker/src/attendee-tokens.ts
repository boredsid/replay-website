// Minting and normalising attendee credentials.
//
// Every value here is generated from `crypto.getRandomValues`. None of them may
// come from `Math.random()`: a pairing code is the entire credential a device
// presents, and a predictable one hands an attacker somebody else's identity.

/**
 * Crockford base32. Excludes I, L, O and U — the first three because they are
 * misread as 1, 1 and 0 across a busy desk, and U because excluding it avoids
 * generating unfortunate words.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Eight characters ≈ 40 bits. See `generatePairingCode`. */
const PAIRING_CODE_LENGTH = 8;

function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

function toCrockford(bytes: Uint8Array): string {
  // 32 divides 256 exactly, so masking the low five bits is uniform across the
  // alphabet — no rejection sampling needed, and no modulo bias to reason about.
  let out = '';
  for (const byte of bytes) out += CROCKFORD[byte & 31];
  return out;
}

/**
 * The pairing code: the whole credential, with no second factor.
 *
 * There is no phone to bind it to — a guest seat has no number on record until
 * the desk captures one — so the code has to stand alone. Eight Crockford
 * characters is ~40 bits, which is not findable by guessing against the pool of
 * codes live at any moment. Six digits, the obvious choice, is not.
 */
export function generatePairingCode(): string {
  return toCrockford(randomBytes(PAIRING_CODE_LENGTH));
}

/**
 * Accepts what someone actually types off a kiosk screen.
 *
 * Uppercases, drops spaces and hyphens, and folds Crockford's confusable
 * characters onto the digits they resemble. Someone reading `0` as `O` still
 * gets in, which matters when the alternative is walking back to the desk.
 */
export function normalizePairingCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export function isWellFormedPairingCode(code: string): boolean {
  if (code.length !== PAIRING_CODE_LENGTH) return false;
  for (const char of code) if (!CROCKFORD.includes(char)) return false;
  return true;
}

/** 256 bits, base64url. Sent to the client once and never stored in the clear. */
export function generateDeviceToken(): string {
  const bytes = randomBytes(32);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The QR payload: 128 bits of opaque Crockford base32.
 *
 * It carries no name, phone, registration id or edition, so a photographed QR
 * reveals nothing by inspection — and it authorises nothing on its own, because
 * only an Access-authenticated staff endpoint can resolve it.
 */
export function generateQrToken(): string {
  return toCrockford(randomBytes(16));
}

/**
 * SHA-256, hex. Everything is stored hashed so a database leak yields no live
 * credential; the plaintext exists only in the response that mints it.
 */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reads `Authorization: Bearer <token>`, returning '' when absent or malformed. */
export function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}
