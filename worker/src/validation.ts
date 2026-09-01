// worker/src/validation.ts
// Pure input/output helpers. No dependencies, no env access.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  // The attendee app is on app.replaycon.in and the API on api.replaycon.in, so
  // every one of these is a cross-origin call. Omitting DELETE and PATCH does not
  // fail loudly -- the browser refuses at preflight and the app sees a generic
  // network error, which reads as "you are offline" rather than "this is broken".
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cf-Access-Jwt-Assertion',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function sanitizePhone(input: unknown): string {
  if (typeof input !== 'string') return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export type Day = 'day1' | 'day2';
const KNOWN_DAYS: ReadonlyArray<Day> = ['day1', 'day2'];

export function parseDays(input: unknown): Day[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: Day[] = [];
  for (const v of input) {
    if (v !== 'day1' && v !== 'day2') return null;
    if (out.includes(v as Day)) return null;
    out.push(v as Day);
  }
  return out;
}

export type PassType = 'oneshot' | 'campaign';
export function parsePassType(input: unknown): PassType | null {
  return input === 'oneshot' || input === 'campaign' ? input : null;
}

export type StepReached = 'phone_entered' | 'name_entered' | 'details_entered';
const KNOWN_STEPS: ReadonlyArray<StepReached> = ['phone_entered', 'name_entered', 'details_entered'];

export function parseStepReached(input: unknown): StepReached | null {
  return KNOWN_STEPS.includes(input as StepReached) ? (input as StepReached) : null;
}

export { KNOWN_DAYS, KNOWN_STEPS };
