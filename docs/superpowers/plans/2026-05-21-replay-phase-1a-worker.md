# REPLAY Phase 1A — Worker Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 worker endpoints (lookup-phone, register, edition-spots, cancel-registration, lead) for REPLAY 3 registration, plus the edition seed and email template, with full Vitest coverage matching bgc-website's patterns.

**Architecture:** Each endpoint is a small handler in `worker/src/<name>.ts` with a peer `<name>.test.ts`. Three pure-function helper modules (`validation.ts`, `pricing.ts`, `editions.ts`) factor out shared logic so handlers stay small and individually testable. Tests mock at the helper boundary for handlers and at the supabase boundary for helpers — keeps each layer's tests focused. Apps Script and bgc cross-call helpers from Phase 0 are reused.

**Tech Stack:** Cloudflare Workers (TypeScript), Vitest with `@cloudflare/vitest-pool-workers` pool config, Supabase JS client (service-role), Google Apps Script webhook (email).

**Branch:** `rebuild/phase-0` (continues from Phase 0; no new branch).

**Working directory:** `/Users/siddhantnarula/Projects/replay-website`. All `worker/` commands run from `worker/`.

---

## File Structure

```
worker/src/
├── validation.ts            (NEW) pure helpers: sanitizePhone, parseDays, parsePassType, parseStepReached, jsonResponse, CORS_HEADERS
├── validation.test.ts       (NEW) tests for above
├── pricing.ts               (NEW) readPricing(jsonb), calculateDiscount({base, tier, adventurer_cap})
├── pricing.test.ts          (NEW)
├── editions.ts              (NEW) getEditionById(supabase, id), getConfirmedSeatsByDay(supabase, editionId), dayLabel(day)
├── editions.test.ts         (NEW)
├── lookup-phone.ts          (NEW) handleLookupPhone
├── lookup-phone.test.ts     (NEW)
├── register.ts              (NEW) handleRegister
├── register.test.ts         (NEW)
├── edition-spots.ts         (NEW) handleEditionSpots
├── edition-spots.test.ts    (NEW)
├── cancel-registration.ts   (NEW) handleCancelRegistration
├── cancel-registration.test.ts (NEW)
├── lead.ts                  (NEW) handleLead, _resetLeadRateLimit
├── lead.test.ts             (NEW)
└── index.ts                 (MODIFY) import + route handlers, swap inline `json()` for jsonResponse

src/emails/
└── registration.html        (NEW) email template with {{var}} placeholders

supabase/seeds/
└── replay-3.sql             (NEW) idempotent edition insert
```

All files in `worker/src/` are individually <150 LOC. `index.ts` stays a flat if/else router.

**Boundary rules:**
- Handlers (`*.ts` for endpoints) own request parsing + business logic + response shaping.
- `editions.ts` is the only file that knows the registrations/editions table query shape for capacity counting.
- `validation.ts` is the only place phone/pass-type/days/step-reached input is sanitized.
- `pricing.ts` is the only place that interprets `editions.pricing` JSONB.

---

## Task 1: Add validation.ts helpers + tests

**Files:**
- Create: `worker/src/validation.ts`
- Create: `worker/src/validation.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/validation.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  sanitizePhone,
  parseDays,
  parsePassType,
  parseStepReached,
  jsonResponse,
} from './validation';

describe('sanitizePhone', () => {
  it('strips non-digits and returns last 10', () => {
    expect(sanitizePhone('+91 98765 43210')).toBe('9876543210');
    expect(sanitizePhone('91-9876543210')).toBe('9876543210');
    expect(sanitizePhone('9876543210')).toBe('9876543210');
  });
  it('returns empty string when fewer than 10 digits', () => {
    expect(sanitizePhone('12345')).toBe('');
    expect(sanitizePhone('')).toBe('');
    expect(sanitizePhone('abc')).toBe('');
  });
  it('handles undefined/null defensively', () => {
    expect(sanitizePhone(undefined as any)).toBe('');
    expect(sanitizePhone(null as any)).toBe('');
  });
});

describe('parseDays', () => {
  it('accepts valid arrays', () => {
    expect(parseDays(['day1'])).toEqual(['day1']);
    expect(parseDays(['day2'])).toEqual(['day2']);
    expect(parseDays(['day1', 'day2'])).toEqual(['day1', 'day2']);
  });
  it('rejects empty / non-array / unknown values', () => {
    expect(parseDays([])).toBeNull();
    expect(parseDays('day1')).toBeNull();
    expect(parseDays(['day3'])).toBeNull();
    expect(parseDays(['day1', 'day3'])).toBeNull();
    expect(parseDays(null)).toBeNull();
  });
  it('rejects duplicates', () => {
    expect(parseDays(['day1', 'day1'])).toBeNull();
  });
});

describe('parsePassType', () => {
  it('accepts oneshot and campaign', () => {
    expect(parsePassType('oneshot')).toBe('oneshot');
    expect(parsePassType('campaign')).toBe('campaign');
  });
  it('rejects anything else', () => {
    expect(parsePassType('annual')).toBeNull();
    expect(parsePassType('')).toBeNull();
    expect(parsePassType(undefined)).toBeNull();
  });
});

describe('parseStepReached', () => {
  it('accepts the three known steps', () => {
    expect(parseStepReached('phone_entered')).toBe('phone_entered');
    expect(parseStepReached('name_entered')).toBe('name_entered');
    expect(parseStepReached('details_entered')).toBe('details_entered');
  });
  it('rejects anything else', () => {
    expect(parseStepReached('bogus')).toBeNull();
    expect(parseStepReached('')).toBeNull();
  });
});

describe('jsonResponse', () => {
  it('returns Response with JSON content-type, CORS, and default 200', async () => {
    const res = jsonResponse({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ hello: 'world' });
  });
  it('honors custom status', async () => {
    const res = jsonResponse({ error: 'no' }, 400);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- validation`
Expected: FAIL with "Cannot find module './validation'".

- [ ] **Step 3: Implement `worker/src/validation.ts`**

```ts
// worker/src/validation.ts
// Pure input/output helpers. No dependencies, no env access.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- validation`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/siddhantnarula/Projects/replay-website
git add worker/src/validation.ts worker/src/validation.test.ts
git commit -m "Add validation helpers for worker endpoints

sanitizePhone, parseDays, parsePassType, parseStepReached, plus the
shared jsonResponse + CORS_HEADERS. All pure functions, dependency-free.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Add pricing.ts helpers + tests

**Files:**
- Create: `worker/src/pricing.ts`
- Create: `worker/src/pricing.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/pricing.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { readPricing, calculateBasePrice, calculateDiscount } from './pricing';

const PRICING = {
  oneshot: { day1: 800, day2: 800 },
  campaign: 1400,
  adventurer_cap: 1000,
};

describe('readPricing', () => {
  it('parses a well-formed pricing JSONB', () => {
    expect(readPricing(PRICING)).toEqual(PRICING);
  });
  it('defaults adventurer_cap to Infinity when missing', () => {
    const p = { oneshot: { day1: 600, day2: 600 }, campaign: 999 };
    expect(readPricing(p).adventurer_cap).toBe(Infinity);
  });
  it('throws when oneshot or campaign is missing', () => {
    expect(() => readPricing({ oneshot: { day1: 1 } } as any)).toThrow();
    expect(() => readPricing({ campaign: 1 } as any)).toThrow();
    expect(() => readPricing(null as any)).toThrow();
  });
});

describe('calculateBasePrice', () => {
  it('campaign always returns campaign price regardless of days', () => {
    expect(calculateBasePrice(PRICING, 'campaign', ['day1', 'day2'])).toBe(1400);
  });
  it('oneshot returns the price for the single requested day', () => {
    expect(calculateBasePrice(PRICING, 'oneshot', ['day1'])).toBe(800);
    expect(calculateBasePrice(PRICING, 'oneshot', ['day2'])).toBe(800);
  });
});

describe('calculateDiscount', () => {
  it('returns 0 for no/null tier', () => {
    expect(calculateDiscount({ base: 800, tier: null, adventurer_cap: 1000 })).toBe(0);
  });
  it('initiate: 20% of base, integer rounded', () => {
    expect(calculateDiscount({ base: 800, tier: 'initiate', adventurer_cap: 1000 })).toBe(160);
    expect(calculateDiscount({ base: 999, tier: 'initiate', adventurer_cap: 1000 })).toBe(200); // 199.8 rounds to 200
  });
  it('adventurer: min(base, cap)', () => {
    expect(calculateDiscount({ base: 800, tier: 'adventurer', adventurer_cap: 1000 })).toBe(800);
    expect(calculateDiscount({ base: 1400, tier: 'adventurer', adventurer_cap: 1000 })).toBe(1000);
    expect(calculateDiscount({ base: 1400, tier: 'adventurer', adventurer_cap: Infinity })).toBe(1400);
  });
  it('guildmaster: full base', () => {
    expect(calculateDiscount({ base: 1400, tier: 'guildmaster', adventurer_cap: 1000 })).toBe(1400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- pricing`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `worker/src/pricing.ts`**

```ts
// worker/src/pricing.ts
import type { Day, PassType } from './validation';
import type { GuildTier } from './bgc-client';

export interface Pricing {
  oneshot: { day1: number; day2: number };
  campaign: number;
  adventurer_cap: number; // Infinity when uncapped
}

export function readPricing(input: unknown): Pricing {
  if (!input || typeof input !== 'object') {
    throw new Error('pricing: not an object');
  }
  const p = input as any;
  if (
    !p.oneshot ||
    typeof p.oneshot.day1 !== 'number' ||
    typeof p.oneshot.day2 !== 'number'
  ) {
    throw new Error('pricing: oneshot.{day1,day2} required as numbers');
  }
  if (typeof p.campaign !== 'number') {
    throw new Error('pricing: campaign required as number');
  }
  const cap = typeof p.adventurer_cap === 'number' ? p.adventurer_cap : Infinity;
  return {
    oneshot: { day1: p.oneshot.day1, day2: p.oneshot.day2 },
    campaign: p.campaign,
    adventurer_cap: cap,
  };
}

export function calculateBasePrice(pricing: Pricing, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return pricing.campaign;
  // oneshot: exactly one day, validated upstream
  return pricing.oneshot[days[0]];
}

export function calculateDiscount(args: {
  base: number;
  tier: GuildTier | null;
  adventurer_cap: number;
}): number {
  const { base, tier, adventurer_cap } = args;
  if (tier === null) return 0;
  if (tier === 'initiate') return Math.round(base * 0.2);
  if (tier === 'adventurer') return Math.min(base, adventurer_cap);
  if (tier === 'guildmaster') return base;
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- pricing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/pricing.ts worker/src/pricing.test.ts
git commit -m "Add pricing helpers: readPricing, calculateBasePrice, calculateDiscount

Reads editions.pricing JSONB into a typed Pricing shape (defaulting
adventurer_cap to Infinity when missing). Pure logic, fully unit-tested.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Add editions.ts helpers + tests

**Files:**
- Create: `worker/src/editions.ts`
- Create: `worker/src/editions.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/editions.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));

import { serviceClient } from './supabase';
import { getEditionById, getConfirmedSeatsByDay, dayLabel } from './editions';

function mockSupabase(rows: any) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => rows.edition ?? { data: null, error: null },
        }),
      }),
    }),
    rpc: async (_name: string, _args: any) => ({ data: rows.rpc ?? null, error: null }),
  };
}

describe('getEditionById', () => {
  it('returns the row when found', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'e1', slug: 'replay-3' }, error: null }),
          }),
        }),
      }),
    });
    const row = await getEditionById({} as any, 'e1');
    expect(row).toEqual({ id: 'e1', slug: 'replay-3' });
  });

  it('returns null when not found', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    });
    const row = await getEditionById({} as any, 'missing');
    expect(row).toBeNull();
  });
});

describe('getConfirmedSeatsByDay', () => {
  it('sums seats from confirmed rows, day1+day2 each counted', async () => {
    const rows = [
      { days: ['day1'], seats: 1 },
      { days: ['day1', 'day2'], seats: 1 },
      { days: ['day2'], seats: 2 },
      { days: ['day1', 'day2'], seats: 1 },
    ];
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              then: (cb: any) => cb({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    });
    const out = await getConfirmedSeatsByDay({} as any, 'e1');
    // day1: 1 + 1 + 1 = 3; day2: 1 + 2 + 1 = 4
    expect(out).toEqual({ day1: 3, day2: 4 });
  });

  it('returns zeros when no confirmed rows', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              then: (cb: any) => cb({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });
    const out = await getConfirmedSeatsByDay({} as any, 'e1');
    expect(out).toEqual({ day1: 0, day2: 0 });
  });
});

describe('dayLabel', () => {
  it('joins single and double days into human-readable string', () => {
    expect(dayLabel(['day1'])).toBe('Saturday');
    expect(dayLabel(['day2'])).toBe('Sunday');
    expect(dayLabel(['day1', 'day2'])).toBe('Saturday + Sunday');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- editions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `worker/src/editions.ts`**

```ts
// worker/src/editions.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import type { Day } from './validation';

export interface EditionRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: unknown;
  registration_status: 'upcoming' | 'open' | 'sold_out' | 'closed';
  is_current: boolean;
  is_published: boolean;
}

export async function getEditionById(env: Env, id: string): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('editions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}

export async function getConfirmedSeatsByDay(env: Env, editionId: string): Promise<{ day1: number; day2: number }> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('registrations')
    .select('days, seats')
    .eq('edition_id', editionId)
    .eq('payment_status', 'confirmed');
  if (error) throw new Error(`registrations: ${error.message}`);
  let day1 = 0;
  let day2 = 0;
  for (const row of (data ?? []) as { days: Day[]; seats: number }[]) {
    if (row.days.includes('day1')) day1 += row.seats;
    if (row.days.includes('day2')) day2 += row.seats;
  }
  return { day1, day2 };
}

const DAY_NAMES: Record<Day, string> = { day1: 'Saturday', day2: 'Sunday' };
export function dayLabel(days: Day[]): string {
  return days.map((d) => DAY_NAMES[d]).join(' + ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- editions`
Expected: PASS.

> Note: the test mocks the supabase query chain. If the mock chain doesn't match (e.g. the `.then(cb)` pattern in the second describe isn't actually how `@supabase/supabase-js` resolves), simplify the mock to use Promise.resolve directly. The pattern below also works:
> ```ts
> from: () => Object.assign(Promise.resolve({ data: [], error: null }), {
>   select: () => Object.assign(Promise.resolve({ data: [], error: null }), {
>     eq: () => Object.assign(Promise.resolve({ data: [], error: null }), {
>       eq: () => Promise.resolve({ data: [], error: null }),
>     }),
>   }),
> }),
> ```
> If the simpler thenable pattern in the test works, leave as-is.

- [ ] **Step 5: Commit**

```bash
git add worker/src/editions.ts worker/src/editions.test.ts
git commit -m "Add edition helpers: getEditionById, getConfirmedSeatsByDay, dayLabel

Single-source-of-truth for capacity counting and edition lookups.
Other handlers consume these instead of inlining supabase queries.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: lookup-phone endpoint

**Files:**
- Create: `worker/src/lookup-phone.ts`
- Create: `worker/src/lookup-phone.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/lookup-phone.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./bgc-client', () => ({ fetchGuildStatus: vi.fn() }));

import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { handleLookupPhone } from './lookup-phone';

function mockEnv() {
  return {
    SUPABASE_URL: 'x',
    SUPABASE_SERVICE_KEY: 'x',
    BGC_WORKER_URL: 'x',
    REPLAY_TO_BGC_SECRET: 'x',
  } as any;
}

function mockSupabase(opts: {
  user?: { phone: string; name: string | null; email: string | null } | null;
  existingRegs?: Array<{ payment_status: string }>;
}) {
  const user = opts.user ?? null;
  const regs = opts.existingRegs ?? [];
  return {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: user, error: null }),
            }),
          }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: async () => ({ data: regs, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleLookupPhone', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '12', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('returns user.found=false for unknown phone', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({ user: null }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.user.found).toBe(false);
    expect(body.guild.active).toBe(false);
    expect(body.existing_for_edition.count).toBe(0);
    expect(body.discount_blocked).toBe(false);
  });

  it('active guild + no prior regs => discount_blocked=false', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      user: { phone: '9876543210', name: 'Asha', email: 'a@b.c' },
      existingRegs: [],
    }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'adventurer', active: true });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    const body: any = await res.json();
    expect(body.user.found).toBe(true);
    expect(body.guild).toEqual({ tier: 'adventurer', active: true });
    expect(body.discount_blocked).toBe(false);
  });

  it('active guild + prior confirmed reg => discount_blocked=true', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      user: { phone: '9876543210', name: 'Asha', email: 'a@b.c' },
      existingRegs: [{ payment_status: 'confirmed' }],
    }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    const body: any = await res.json();
    expect(body.existing_for_edition.count).toBe(1);
    expect(body.existing_for_edition.has_confirmed).toBe(true);
    expect(body.discount_blocked).toBe(true);
  });

  it('inactive guild + prior reg => discount_blocked=false (no discount to block)', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      user: { phone: '9876543210', name: 'Asha', email: 'a@b.c' },
      existingRegs: [{ payment_status: 'pending' }],
    }));
    (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
    const req = new Request('http://x/api/lookup-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    });
    const res = await handleLookupPhone(req, mockEnv());
    const body: any = await res.json();
    expect(body.discount_blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- lookup-phone`
Expected: FAIL.

- [ ] **Step 3: Implement `worker/src/lookup-phone.ts`**

```ts
// worker/src/lookup-phone.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleLookupPhone(req: Request, env: Env): Promise<Response> {
  let phone = '';
  let editionId = '';
  try {
    const body = await req.json<{ phone?: string; edition_id?: string }>();
    phone = sanitizePhone(body.phone);
    editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);

  const sb = serviceClient(env);
  const [userRes, guildRes, regsRes] = await Promise.all([
    sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle(),
    fetchGuildStatus(env, phone),
    sb
      .from('registrations')
      .select('payment_status')
      .eq('edition_id', editionId)
      .eq('user_phone', phone)
      .neq('payment_status', 'cancelled'),
  ]);

  const user = userRes.data as { phone: string; name: string | null; email: string | null } | null;
  const regs = (regsRes.data ?? []) as Array<{ payment_status: string }>;
  const hasConfirmed = regs.some((r) => r.payment_status === 'confirmed');
  const discountBlocked = guildRes.active && regs.length > 0;

  return jsonResponse({
    user: {
      found: !!user,
      name: user?.name ?? null,
      email: user?.email ?? null,
    },
    guild: guildRes,
    existing_for_edition: {
      count: regs.length,
      has_confirmed: hasConfirmed,
    },
    discount_blocked: discountBlocked,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- lookup-phone`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lookup-phone.ts worker/src/lookup-phone.test.ts
git commit -m "Add lookup-phone endpoint

Combined user + guild + existing-registration lookup for the
registration form. discount_blocked drives the anti-split UX hint.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: register endpoint

**Files:**
- Create: `worker/src/register.ts`
- Create: `worker/src/register.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/register.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
vi.mock('./bgc-client', () => ({ fetchGuildStatus: vi.fn() }));
vi.mock('./apps-script', () => ({ sendEmail: vi.fn() }));
vi.mock('./editions', () => ({
  getEditionById: vi.fn(),
  getConfirmedSeatsByDay: vi.fn(),
  dayLabel: (days: string[]) => days.join('+'),
}));

import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { sendEmail } from './apps-script';
import { getEditionById, getConfirmedSeatsByDay } from './editions';
import { handleRegister } from './register';

function mockEnv() {
  return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x', BGC_WORKER_URL: 'x', REPLAY_TO_BGC_SECRET: 'x', APPS_SCRIPT_URL: 'x', APPS_SCRIPT_SECRET: 'x' } as any;
}

function defaultEdition() {
  return {
    id: 'e1',
    slug: 'replay-3',
    name: 'REPLAY 3',
    start_date: '2026-09-12',
    end_date: '2026-09-13',
    venue: 'TBD',
    capacity_per_day: { day1: 250, day2: 250 },
    pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 },
    registration_status: 'open' as const,
    is_current: true,
    is_published: true,
  };
}

function mockSupabase(opts: {
  existingUser?: any;
  existingRegs?: Array<{ payment_status: string }>;
  insertedUser?: any;
  insertedReg?: any;
  leadConverted?: boolean;
  capture?: { reg?: any; user?: any; leadUpdate?: any };
}) {
  const cap = opts.capture ?? {};
  return {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.existingUser ?? null, error: null }),
            }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                cap.user = row;
                return { data: opts.insertedUser ?? { ...row, phone: row.phone }, error: null };
              },
            }),
          }),
          update: (row: any) => ({
            eq: async () => {
              cap.user = row;
              return { error: null };
            },
          }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: async () => ({ data: opts.existingRegs ?? [], error: null }),
              }),
            }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                cap.reg = row;
                return { data: { id: 'reg-1', ...row }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'leads') {
        return {
          update: (row: any) => ({
            eq: () => ({
              eq: async () => {
                cap.leadUpdate = row;
                return { error: null };
              },
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function validBody(overrides: Partial<any> = {}) {
  return JSON.stringify({
    phone: '9876543210',
    name: 'Asha',
    email: 'a@b.c',
    edition_id: 'e1',
    pass_type: 'oneshot',
    days: ['day1'],
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  (getEditionById as any).mockResolvedValue(defaultEdition());
  (getConfirmedSeatsByDay as any).mockResolvedValue({ day1: 0, day2: 0 });
  (fetchGuildStatus as any).mockResolvedValue({ tier: null, active: false });
  (sendEmail as any).mockResolvedValue(undefined);
});

describe('handleRegister', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ phone: '12' }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects when registration_status != open with 409', async () => {
    (getEditionById as any).mockResolvedValue({ ...defaultEdition(), registration_status: 'upcoming' });
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody() });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.error).toBe('registration_closed');
  });

  it('rejects when day capacity exceeded', async () => {
    (getConfirmedSeatsByDay as any).mockResolvedValue({ day1: 250, day2: 0 });
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody() });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body).toEqual({ error: 'sold_out', day: 'day1' });
  });

  it('guildmaster gets full discount and confirmed status + email dispatched', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({ existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' }, capture: cap }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.final_amount).toBe(0);
    expect(body.discount_applied).toBe(1400);
    expect(body.payment_required).toBe(false);
    expect(cap.reg.payment_status).toBe('confirmed');
    expect(cap.reg.guild_tier_at_purchase).toBe('guildmaster');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('adventurer with cap=1000 against campaign 1400 => final=400 + pending status', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'adventurer', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({ existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' }, capture: cap }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    const body: any = await res.json();
    expect(body.final_amount).toBe(400);
    expect(body.discount_applied).toBe(1000);
    expect(body.payment_required).toBe(true);
    expect(cap.reg.payment_status).toBe('pending');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('anti-split: active guild with existing reg => discount_blocked + 0 discount', async () => {
    (fetchGuildStatus as any).mockResolvedValue({ tier: 'guildmaster', active: true });
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({
      existingUser: { phone: '9876543210', name: 'A', email: 'a@b.c' },
      existingRegs: [{ payment_status: 'confirmed' }],
      capture: cap,
    }));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    const body: any = await res.json();
    expect(body.discount_blocked).toBe(true);
    expect(body.discount_applied).toBe(0);
    expect(body.final_amount).toBe(1400);
    expect(cap.reg.guild_tier_at_purchase).toBeNull();
  });

  it('rejects campaign with single day with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'campaign', days: ['day1'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects oneshot with multiple days with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x/api/register', { method: 'POST', body: validBody({ pass_type: 'oneshot', days: ['day1', 'day2'] }) });
    const res = await handleRegister(req, mockEnv());
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- register`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `worker/src/register.ts`**

```ts
// worker/src/register.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { sendEmail } from './apps-script';
import {
  sanitizePhone,
  parseDays,
  parsePassType,
  jsonResponse,
  type Day,
} from './validation';
import { readPricing, calculateBasePrice, calculateDiscount } from './pricing';
import { getEditionById, getConfirmedSeatsByDay, dayLabel } from './editions';

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  const phone = sanitizePhone(body.phone);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  const source = body.source ?? null;

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!name) return jsonResponse({ error: 'invalid name' }, 400);
  if (!email) return jsonResponse({ error: 'invalid email' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!passType) return jsonResponse({ error: 'invalid pass_type' }, 400);
  if (!days) return jsonResponse({ error: 'invalid days' }, 400);
  if (passType === 'campaign' && (days.length !== 2 || !days.includes('day1') || !days.includes('day2'))) {
    return jsonResponse({ error: 'campaign requires both days' }, 400);
  }
  if (passType === 'oneshot' && days.length !== 1) {
    return jsonResponse({ error: 'oneshot requires exactly one day' }, 400);
  }

  const edition = await getEditionById(env, editionId);
  if (!edition) return jsonResponse({ error: 'edition not found' }, 404);
  if (edition.registration_status !== 'open') {
    return jsonResponse({ error: 'registration_closed' }, 409);
  }

  const pricing = readPricing(edition.pricing);
  const base = calculateBasePrice(pricing, passType, days);

  // Upsert user
  const sb = serviceClient(env);
  const userLookup = await sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle();
  if (!userLookup.data) {
    await sb.from('users').insert({ phone, name, email: email || null }).select().single();
  } else {
    const patch: any = {};
    if (name) patch.name = name;
    if (email) patch.email = email;
    if (Object.keys(patch).length > 0) {
      await sb.from('users').update(patch).eq('phone', phone);
    }
  }

  // Guild lookup + anti-split + discount
  const guild = await fetchGuildStatus(env, phone);
  const existingRegsRes = await sb
    .from('registrations')
    .select('payment_status')
    .eq('edition_id', editionId)
    .eq('user_phone', phone)
    .neq('payment_status', 'cancelled');
  const existingCount = (existingRegsRes.data ?? []).length;
  const discountBlocked = guild.active && existingCount > 0;

  let discount = 0;
  let tierStored: typeof guild.tier = null;
  if (!discountBlocked && guild.active) {
    discount = calculateDiscount({ base, tier: guild.tier, adventurer_cap: pricing.adventurer_cap });
    tierStored = guild.tier;
  }

  // Capacity gate
  const seatsByDay = await getConfirmedSeatsByDay(env, editionId);
  for (const d of days) {
    if (seatsByDay[d] + 1 > edition.capacity_per_day[d]) {
      return jsonResponse({ error: 'sold_out', day: d }, 409);
    }
  }

  const amountPaid = base - discount;
  const paymentStatus = amountPaid === 0 ? 'confirmed' : 'pending';

  const regInsert = await sb
    .from('registrations')
    .insert({
      edition_id: editionId,
      user_phone: phone,
      pass_type: passType,
      days,
      seats: 1,
      amount_paid: amountPaid,
      discount_applied: discount,
      guild_tier_at_purchase: tierStored,
      payment_status: paymentStatus,
      source,
    })
    .select()
    .single();
  if (regInsert.error || !regInsert.data) {
    return jsonResponse({ error: 'registration_insert_failed' }, 500);
  }
  const reg = regInsert.data as { id: string };

  // Convert any matching lead
  await sb.from('leads').update({ converted_at: new Date().toISOString() }).eq('edition_id', editionId).eq('phone', phone);

  // Email if zero-payment
  if (amountPaid === 0) {
    try {
      await sendEmail(env, {
        template: 'replay-registration',
        to: email,
        subject: `REPLAY ${edition.name} — registration confirmed`,
        variables: {
          name,
          edition_name: edition.name,
          venue: edition.venue,
          start_date: edition.start_date,
          end_date: edition.end_date,
          pass_type: passType,
          days_label: dayLabel(days),
          seats: 1,
          amount_paid: amountPaid,
          discount_applied: discount,
          guild_tier: tierStored ?? '',
        },
      });
    } catch (e) {
      // Email failure should not break registration; log and continue.
      console.error('email_failed', e);
    }
  }

  return jsonResponse({
    registration_id: reg.id,
    final_amount: amountPaid,
    discount_applied: discount,
    discount_blocked: discountBlocked,
    payment_required: amountPaid > 0,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- register`
Expected: PASS, 8/8 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/register.ts worker/src/register.test.ts
git commit -m "Add register endpoint with Guild discount + anti-split + capacity

Reads pricing from editions.pricing JSONB, applies Guild Path discount
with per-edition Adventurer cap, enforces anti-split fraud check, gates
on per-day capacity, dispatches confirmation email when amount_paid=0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: edition-spots endpoint

**Files:**
- Create: `worker/src/edition-spots.ts`
- Create: `worker/src/edition-spots.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/edition-spots.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./editions', () => ({
  getEditionById: vi.fn(),
  getConfirmedSeatsByDay: vi.fn(),
}));

import { getEditionById, getConfirmedSeatsByDay } from './editions';
import { handleEditionSpots } from './edition-spots';

function env() { return {} as any; }

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleEditionSpots', () => {
  it('returns 404 when edition not found', async () => {
    (getEditionById as any).mockResolvedValue(null);
    const res = await handleEditionSpots('missing', env());
    expect(res.status).toBe(404);
  });

  it('zero registrations => remaining equals capacity', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getConfirmedSeatsByDay as any).mockResolvedValue({ day1: 0, day2: 0 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body).toEqual({
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
  });

  it('mixed: day1 sold out, day2 partial', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getConfirmedSeatsByDay as any).mockResolvedValue({ day1: 250, day2: 100 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body.day1).toEqual({ capacity: 250, remaining: 0, sold_out: true });
    expect(body.day2).toEqual({ capacity: 250, remaining: 150, sold_out: false });
    expect(body.both_sold_out).toBe(false);
  });

  it('both sold out', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getConfirmedSeatsByDay as any).mockResolvedValue({ day1: 250, day2: 250 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body.both_sold_out).toBe(true);
  });

  it('clamps remaining to 0 when seats exceed capacity (overshoot safety)', async () => {
    (getEditionById as any).mockResolvedValue({ id: 'e1', capacity_per_day: { day1: 250, day2: 250 } });
    (getConfirmedSeatsByDay as any).mockResolvedValue({ day1: 280, day2: 0 });
    const res = await handleEditionSpots('e1', env());
    const body: any = await res.json();
    expect(body.day1.remaining).toBe(0);
    expect(body.day1.sold_out).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- edition-spots`
Expected: FAIL.

- [ ] **Step 3: Implement `worker/src/edition-spots.ts`**

```ts
// worker/src/edition-spots.ts
import type { Env } from './index';
import { jsonResponse } from './validation';
import { getEditionById, getConfirmedSeatsByDay } from './editions';

export async function handleEditionSpots(editionId: string, env: Env): Promise<Response> {
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  const edition = await getEditionById(env, editionId);
  if (!edition) return jsonResponse({ error: 'not_found' }, 404);

  const seats = await getConfirmedSeatsByDay(env, editionId);
  const cap = edition.capacity_per_day;

  const day1Remaining = Math.max(0, cap.day1 - seats.day1);
  const day2Remaining = Math.max(0, cap.day2 - seats.day2);
  const day1SoldOut = day1Remaining === 0;
  const day2SoldOut = day2Remaining === 0;

  return jsonResponse({
    day1: { capacity: cap.day1, remaining: day1Remaining, sold_out: day1SoldOut },
    day2: { capacity: cap.day2, remaining: day2Remaining, sold_out: day2SoldOut },
    both_sold_out: day1SoldOut && day2SoldOut,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- edition-spots`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add worker/src/edition-spots.ts worker/src/edition-spots.test.ts
git commit -m "Add edition-spots endpoint

Reports per-day capacity / remaining / sold_out for an edition. Used
by the site for live spot badges.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: cancel-registration endpoint

**Files:**
- Create: `worker/src/cancel-registration.ts`
- Create: `worker/src/cancel-registration.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/cancel-registration.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
import { serviceClient } from './supabase';
import { handleCancelRegistration } from './cancel-registration';

function env() { return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any; }

function mockSupabase(opts: { reg?: any; updateCapture?: { row: any } }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.reg ?? null, error: null }),
        }),
      }),
      update: (row: any) => ({
        eq: async () => {
          if (opts.updateCapture) opts.updateCapture.row = row;
          return { error: null };
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('handleCancelRegistration', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '12' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(400);
  });

  it('returns 404 when registration not found', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({ reg: null }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(404);
  });

  it('returns 403 when phone does not match registration owner', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      reg: { id: 'r1', user_phone: '9999999999', payment_status: 'pending' },
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(403);
  });

  it('returns 409 when already cancelled', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({
      reg: { id: 'r1', user_phone: '9876543210', payment_status: 'cancelled' },
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(409);
  });

  it('cancels a valid pending registration', async () => {
    const cap: any = {};
    (serviceClient as any).mockReturnValue(mockSupabase({
      reg: { id: 'r1', user_phone: '9876543210', payment_status: 'pending' },
      updateCapture: cap,
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ registration_id: 'r1', phone: '9876543210' }) });
    const res = await handleCancelRegistration(req, env());
    expect(res.status).toBe(200);
    expect(cap.row.payment_status).toBe('cancelled');
    const body: any = await res.json();
    expect(body).toEqual({ ok: true, registration_id: 'r1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- cancel-registration`
Expected: FAIL.

- [ ] **Step 3: Implement `worker/src/cancel-registration.ts`**

```ts
// worker/src/cancel-registration.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleCancelRegistration(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }
  const registrationId = typeof body.registration_id === 'string' ? body.registration_id : '';
  const phone = sanitizePhone(body.phone);
  if (!registrationId) return jsonResponse({ error: 'invalid registration_id' }, 400);
  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);

  const sb = serviceClient(env);
  const lookup = await sb
    .from('registrations')
    .select('id, user_phone, payment_status')
    .eq('id', registrationId)
    .maybeSingle();
  const reg = lookup.data as { id: string; user_phone: string; payment_status: string } | null;
  if (!reg) return jsonResponse({ error: 'not_found' }, 404);
  if (reg.user_phone !== phone) return jsonResponse({ error: 'forbidden' }, 403);
  if (reg.payment_status === 'cancelled') return jsonResponse({ error: 'already_cancelled' }, 409);

  const { error } = await sb.from('registrations').update({ payment_status: 'cancelled' }).eq('id', registrationId);
  if (error) return jsonResponse({ error: 'update_failed' }, 500);

  return jsonResponse({ ok: true, registration_id: registrationId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- cancel-registration`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add worker/src/cancel-registration.ts worker/src/cancel-registration.test.ts
git commit -m "Add cancel-registration endpoint

Phone-as-anti-grief check, idempotent, frees capacity on cancellation.
No automatic refund — refunds remain manual via UPI (matches legacy).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: lead endpoint with rate-limit

**Files:**
- Create: `worker/src/lead.ts`
- Create: `worker/src/lead.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/lead.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));
import { serviceClient } from './supabase';
import { handleLead, _resetLeadRateLimit } from './lead';

function env() { return { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any; }

function mockSupabase(opts: {
  editionExists?: boolean;
  existingLead?: any;
  upsertCapture?: { row: any; onConflict: string | null };
}) {
  const eventExists = opts.editionExists ?? true;
  return {
    from: (table: string) => {
      if (table === 'editions') {
        return {
          select: () => ({
            eq: (_c: string, v: string) => ({
              maybeSingle: async () => ({ data: eventExists ? { id: v } : null, error: null }),
            }),
          }),
        };
      }
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.existingLead ?? null, error: null }),
              }),
            }),
          }),
          upsert: (row: any, opts2: any) => {
            if (opts.upsertCapture) {
              opts.upsertCapture.row = row;
              opts.upsertCapture.onConflict = opts2?.onConflict ?? null;
            }
            return { error: null };
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetLeadRateLimit();
});

describe('handleLead', () => {
  it('rejects invalid phone with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '12', edition_id: 'e1', step_reached: 'phone_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(400);
  });

  it('rejects unknown edition with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({ editionExists: false }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', edition_id: 'missing', step_reached: 'phone_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(400);
  });

  it('rejects invalid step_reached with 400', async () => {
    (serviceClient as any).mockReturnValue(mockSupabase({}));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', edition_id: 'e1', step_reached: 'bogus' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(400);
  });

  it('upserts a new lead with onConflict on (edition_id,phone)', async () => {
    const cap: any = { row: null, onConflict: null };
    (serviceClient as any).mockReturnValue(mockSupabase({ upsertCapture: cap }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', name: 'Asha', edition_id: 'e1', step_reached: 'name_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(200);
    expect(cap.onConflict).toBe('edition_id,phone');
    expect(cap.row.phone).toBe('9876543210');
    expect(cap.row.name).toBe('Asha');
    expect(cap.row.edition_id).toBe('e1');
    expect(cap.row.step_reached).toBe('name_entered');
  });

  it('skips writes when lead is already converted', async () => {
    const cap: any = { row: null, onConflict: null };
    (serviceClient as any).mockReturnValue(mockSupabase({
      existingLead: { id: 'L1', converted_at: '2026-05-01T00:00:00Z' },
      upsertCapture: cap,
    }));
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '9876543210', edition_id: 'e1', step_reached: 'phone_entered' }) });
    const res = await handleLead(req, env());
    expect(res.status).toBe(200);
    expect(cap.row).toBeNull();
  });

  it('rate-limit: drops second call within 2s without writing', async () => {
    const cap: any = { row: null, onConflict: null };
    (serviceClient as any).mockReturnValue(mockSupabase({ upsertCapture: cap }));
    const body = JSON.stringify({ phone: '9876543210', edition_id: 'e1', step_reached: 'phone_entered' });
    await handleLead(new Request('http://x', { method: 'POST', body }), env());
    expect(cap.row).not.toBeNull();
    cap.row = null;
    const res2 = await handleLead(new Request('http://x', { method: 'POST', body }), env());
    expect(res2.status).toBe(200);
    expect(cap.row).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- lead`
Expected: FAIL.

- [ ] **Step 3: Implement `worker/src/lead.ts`**

```ts
// worker/src/lead.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { sanitizePhone, parseStepReached, jsonResponse } from './validation';

const RATE_LIMIT_MS = 2000;
let rateLimitMap = new Map<string, number>();

export function _resetLeadRateLimit() {
  rateLimitMap = new Map();
}

export async function handleLead(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }
  const phone = sanitizePhone(body.phone);
  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const step = parseStepReached(body.step_reached);
  const name = typeof body.name === 'string' ? body.name.trim() : null;

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!step) return jsonResponse({ error: 'invalid step_reached' }, 400);

  const key = `${editionId}:${phone}`;
  const now = Date.now();
  const last = rateLimitMap.get(key);
  if (last && now - last < RATE_LIMIT_MS) {
    return jsonResponse({ ok: true });
  }
  rateLimitMap.set(key, now);

  const sb = serviceClient(env);
  const editionRow = await sb.from('editions').select('id').eq('id', editionId).maybeSingle();
  if (!editionRow.data) return jsonResponse({ error: 'edition not found' }, 400);

  const existing = await sb
    .from('leads')
    .select('id, converted_at')
    .eq('edition_id', editionId)
    .eq('phone', phone)
    .maybeSingle();
  if ((existing.data as any)?.converted_at) {
    return jsonResponse({ ok: true });
  }

  const upsertRow: any = { edition_id: editionId, phone, step_reached: step };
  if (name) upsertRow.name = name;
  const { error } = await sb.from('leads').upsert(upsertRow, { onConflict: 'edition_id,phone' });
  if (error) return jsonResponse({ error: 'lead_insert_failed' }, 500);

  return jsonResponse({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npm test -- lead`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lead.ts worker/src/lead.test.ts
git commit -m "Add lead capture endpoint with in-memory rate limit

Partial form capture for funnel analytics. 2s rate-limit per
(edition_id, phone) avoids dupe writes from rapid keystrokes. Converted
leads (those whose phone later completes a registration) are not
re-touched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Wire endpoints into index.ts router

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Read current index.ts**

The Phase 0 file has an inline `json()` helper, `CORS_HEADERS` const, and only `/api/health` routing. We'll swap to importing `jsonResponse`/`CORS_HEADERS` from `validation.ts` and add the 5 new routes.

- [ ] **Step 2: Replace `worker/src/index.ts` contents**

```ts
// worker/src/index.ts
import { jsonResponse, CORS_HEADERS } from './validation';
import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEditionSpots } from './edition-spots';
import { handleCancelRegistration } from './cancel-registration';
import { handleLead } from './lead';

export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  APPS_SCRIPT_URL: string;
  APPS_SCRIPT_SECRET: string;
  REPLAY_SITE_URL: string;
  BGC_WORKER_URL: string;
  REPLAY_TO_BGC_SECRET: string;
  UPI_ID: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  CLOUDFLARE_PAGES_DEPLOY_HOOK: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === '/api/health') {
        return jsonResponse({ ok: true, env: env.ENVIRONMENT });
      }
      if (path === '/api/lookup-phone' && req.method === 'POST') {
        return await handleLookupPhone(req, env);
      }
      if (path === '/api/register' && req.method === 'POST') {
        return await handleRegister(req, env);
      }
      if (path.startsWith('/api/edition-spots/') && req.method === 'GET') {
        const editionId = path.split('/api/edition-spots/')[1];
        return await handleEditionSpots(editionId, env);
      }
      if (path === '/api/cancel-registration' && req.method === 'POST') {
        return await handleCancelRegistration(req, env);
      }
      if (path === '/api/lead' && req.method === 'POST') {
        return await handleLead(req, env);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('worker_error', err);
      return jsonResponse({ error: 'internal' }, 500);
    }
  },
};
```

- [ ] **Step 3: Confirm worker types still compile**

Run: `cd worker && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Re-run the full worker test suite**

Run: `cd worker && npm test`
Expected: All tests pass. Total count: validation (9) + pricing (8) + editions (5) + lookup-phone (5) + register (8) + edition-spots (5) + cancel-registration (5) + lead (6) + access-auth (7) + bgc-client (2) + index (2) ≈ 62 tests across 11 files.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "Wire 5 new endpoints into worker router

Routes /api/lookup-phone, /api/register, /api/edition-spots/:id,
/api/cancel-registration, /api/lead. Uses shared jsonResponse +
CORS_HEADERS from validation.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Email template

**Files:**
- Create: `src/emails/registration.html`

- [ ] **Step 1: Write `src/emails/registration.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>REPLAY — registration confirmed</title>
  </head>
  <body style="margin:0;padding:0;background:#FFF8F0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1A1A1A;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8F0;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #F0E6D8;">
            <tr>
              <td style="background:#F47B20;color:#ffffff;padding:24px 32px;">
                <div style="font-size:14px;letter-spacing:.15em;text-transform:uppercase;opacity:.9;">REPLAY</div>
                <div style="font-size:26px;font-weight:700;margin-top:4px;">You're in for {{edition_name}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <p style="margin:0 0 16px 0;font-size:16px;">Hey {{name}},</p>
                <p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">
                  Your registration for <strong>{{edition_name}}</strong> is confirmed. See you at {{venue}} on {{days_label}} ({{start_date}} – {{end_date}}).
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #F0E6D8;border-radius:8px;">
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;"><strong>Pass</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;">{{pass_type}} — {{days_label}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;"><strong>Seats</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;">{{seats}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;"><strong>Amount paid</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;">₹{{amount_paid}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;"><strong>Discount</strong></td>
                    <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #F0E6D8;">₹{{discount_applied}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 16px;font-size:14px;"><strong>Guild Path</strong></td>
                    <td style="padding:12px 16px;font-size:14px;">{{guild_tier}}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 28px 32px;font-size:13px;color:#666;line-height:1.5;">
                Reply to this email if anything looks off. We'll be in touch closer to the convention with venue + schedule details.
                <br/><br/>
                — Team REPLAY
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/emails/registration.html
git commit -m "Add registration confirmation email template

Inline-CSS HTML with {{variable}} placeholders. Functional design,
REPLAY orange header. Visual rework lands in Phase 1C.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: REPLAY 3 edition seed

**Files:**
- Create: `supabase/seeds/replay-3.sql`

- [ ] **Step 1: Write `supabase/seeds/replay-3.sql`**

```sql
-- supabase/seeds/replay-3.sql
-- Seeds the REPLAY 3 edition. Idempotent — safe to re-run.
-- Sept 12-13, 2026. 250 seats per day. Pricing: ₹800/day oneshot, ₹1400 campaign.
-- Adventurer cap is ₹1000 (legacy parity).

insert into editions (
  slug, name, start_date, end_date, venue,
  capacity_per_day, pricing,
  registration_status, is_current, is_published
) values (
  'replay-3',
  'REPLAY 3',
  '2026-09-12', '2026-09-13',
  'TBD',
  '{"day1": 250, "day2": 250}'::jsonb,
  '{"oneshot": {"day1": 800, "day2": 800}, "campaign": 1400, "adventurer_cap": 1000}'::jsonb,
  'upcoming',
  true,
  false
)
on conflict (slug) do update set
  name             = excluded.name,
  start_date       = excluded.start_date,
  end_date         = excluded.end_date,
  venue            = excluded.venue,
  capacity_per_day = excluded.capacity_per_day,
  pricing          = excluded.pricing;
-- registration_status / is_current / is_published intentionally NOT overwritten,
-- so a re-run never accidentally flips live flags.
```

- [ ] **Step 2: Apply to production Supabase**

Use the Supabase MCP. Call `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id`: `qvkynwlmzeybdiapbcsy`
- `name`: `seed_replay_3`
- `query`: contents of `supabase/seeds/replay-3.sql`

Expected: `{"success":true}`.

- [ ] **Step 3: Verify the row exists**

Call `mcp__claude_ai_Supabase__execute_sql` with project_id `qvkynwlmzeybdiapbcsy` and query:

```sql
select id, slug, name, registration_status, is_current, is_published, capacity_per_day, pricing
from editions where slug = 'replay-3';
```

Expected: one row, `slug='replay-3'`, `is_current=true`, `is_published=false`, `registration_status='upcoming'`, `pricing` includes `adventurer_cap: 1000`. Note the returned `id` — needed for smoke tests in Task 14.

- [ ] **Step 4: Commit**

```bash
git add supabase/seeds/replay-3.sql
git commit -m "Seed REPLAY 3 edition

Sept 12-13 2026 at TBD venue. 250/day. ₹800/day oneshot, ₹1400 campaign,
₹1000 Adventurer cap. is_published + registration_status stay safe by
default; flip them via Studio when 1D cutover lands.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Update Replay Apps Script template URL (USER ACTION)

> **User action required.** You need to be logged into the Google account that owns the Replay Email Webhook GAS project (set up in Phase 0 Task 16).

The deployed GAS project's `Code.gs` currently points to `…/main/src/emails/registration.html`, which doesn't exist on `main` until Phase 1D cutover. Switch it to `rebuild/phase-0` until then.

- [ ] **Step 1: Open the Replay Email Webhook GAS project**

https://script.google.com → find `Replay Email Webhook` → open the editor.

- [ ] **Step 2: Edit `Code.gs` — change the `urls` map**

Find the line in `renderTemplate(template, vars)`:
```js
'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/registration.html',
```

Change to:
```js
'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/rebuild/phase-0/src/emails/registration.html',
```

(The `replay-preorder` entry can stay — its file doesn't exist yet but isn't called from any 1A endpoint.)

- [ ] **Step 3: Save (Cmd-S) and create a new Web App deployment**

Deploy → Manage deployments → pencil icon on the current "Active" deployment → Version: "New version" → Description: `point templates at rebuild/phase-0` → Deploy.

(Do NOT create a brand new deployment with a different URL — that would invalidate `APPS_SCRIPT_URL` worker secret. Use "Manage deployments → edit → new version" to keep the same URL.)

- [ ] **Step 4: Note for Phase 1D**

Add a TODO sticky for Phase 1D: revert this URL to `…/main/…` after cutover. (Already tracked in the parent spec's "Deferred" table.)

---

## Task 13: Deploy worker

**Files:** none modified.

- [ ] **Step 1: Push current branch to origin**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
git push
```

Expected: `rebuild/phase-0` updated on origin.

- [ ] **Step 2: Deploy the worker**

Run:
```bash
cd worker && npx wrangler deploy
```

Expected output ends with `api.replaycon.in (custom domain)` and `Deployed replay-worker triggers`.

- [ ] **Step 3: Verify health endpoint still up**

Use `mcp__plugin_context-mode_context-mode__ctx_execute` (curl is blocked):

```javascript
const res = await fetch('https://api.replaycon.in/api/health');
console.log('status=' + res.status, await res.text());
```

Expected: `status=200 {"ok":true,"env":"production"}`.

---

## Task 14: End-to-end smoke test

**Files:** none modified. Read-only verification against the live worker + Supabase.

First, capture the REPLAY 3 edition id from Task 11 verification step. Note it — the rest of this task uses it.

- [ ] **Step 1: `edition-spots` — capacity baseline**

Run via `mcp__plugin_context-mode_context-mode__ctx_execute`:

```javascript
const EDITION_ID = '<paste replay-3 id from Task 11>';
const res = await fetch(`https://api.replaycon.in/api/edition-spots/${EDITION_ID}`);
console.log('status=' + res.status, await res.text());
```

Expected: `status=200 {"day1":{"capacity":250,"remaining":250,"sold_out":false},"day2":{"capacity":250,"remaining":250,"sold_out":false},"both_sold_out":false}`.

- [ ] **Step 2: `lookup-phone` — non-existent phone**

```javascript
const EDITION_ID = '<paste replay-3 id>';
const res = await fetch('https://api.replaycon.in/api/lookup-phone', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '9999999999', edition_id: EDITION_ID }),
});
console.log('status=' + res.status, await res.text());
```

Expected: `200`, body shows `user.found=false`, `guild.active=false`, `existing_for_edition.count=0`, `discount_blocked=false`.

- [ ] **Step 3: `lookup-phone` — known guild member**

Pick a real active Guild Path member phone from the bgc admin (or from `mcp__claude_ai_Supabase` against bgc's project `yhgtwqdsnrslcgdvmunz` — `select u.phone, m.tier from users u join guild_path_members m on m.user_id=u.id where m.status='paid' and m.expires_at >= now() limit 1`).

```javascript
const EDITION_ID = '<paste replay-3 id>';
const PHONE = '<paste real guild member phone>';
const res = await fetch('https://api.replaycon.in/api/lookup-phone', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: PHONE, edition_id: EDITION_ID }),
});
console.log('status=' + res.status, await res.text());
```

Expected: `200`, `guild.tier=<their tier>`, `guild.active=true`. (If bgc PR #15 isn't merged or production deploy hasn't propagated, `guild.active` may be false — investigate before proceeding.)

- [ ] **Step 4: `register` — verify rejection while registration_status=upcoming**

```javascript
const EDITION_ID = '<paste replay-3 id>';
const res = await fetch('https://api.replaycon.in/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    phone: '9000000001',
    name: 'Smoke Test',
    email: 'smoke@test.local',
    edition_id: EDITION_ID,
    pass_type: 'oneshot',
    days: ['day1'],
  }),
});
console.log('status=' + res.status, await res.text());
```

Expected: `status=409 {"error":"registration_closed"}` (because `registration_status='upcoming'`).

- [ ] **Step 5: Temporary flip to `open` and re-register**

Use `mcp__claude_ai_Supabase__execute_sql` with project `qvkynwlmzeybdiapbcsy`:

```sql
update editions set registration_status = 'open' where slug = 'replay-3';
```

Then re-run the register call from Step 4. Expected: `200`, `final_amount=800` (no guild discount for this fake phone), `payment_required=true`, includes a `registration_id`.

- [ ] **Step 6: `edition-spots` now reflects the pending registration**

Pending rows don't count toward capacity (only `confirmed` does). Spots should still be `remaining=250`. Verify:

```javascript
const EDITION_ID = '<paste replay-3 id>';
const res = await fetch(`https://api.replaycon.in/api/edition-spots/${EDITION_ID}`);
console.log(await res.text());
```

Expected: still `remaining=250` on both days (the registration is `pending`, not `confirmed`).

- [ ] **Step 7: `cancel-registration` — cleanup the smoke test row**

```javascript
const REG_ID = '<paste registration_id from Step 5>';
const res = await fetch('https://api.replaycon.in/api/cancel-registration', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ registration_id: REG_ID, phone: '9000000001' }),
});
console.log('status=' + res.status, await res.text());
```

Expected: `status=200 {"ok":true,"registration_id":"<reg id>"}`.

- [ ] **Step 8: `lead` — happy path + rate-limit**

```javascript
const EDITION_ID = '<paste replay-3 id>';
async function leadCall() {
  return fetch('https://api.replaycon.in/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9000000002', edition_id: EDITION_ID, step_reached: 'phone_entered' }),
  }).then(async r => ({ status: r.status, body: await r.text() }));
}
console.log('lead 1:', await leadCall());
console.log('lead 2 (rate-limited):', await leadCall());
```

Both should return `200 {"ok":true}`. Verify only one row exists via Supabase SQL:

```sql
select count(*) from leads where phone = '9000000002';
```

Expected: 1.

- [ ] **Step 9: Revert `registration_status` to `upcoming`**

```sql
update editions set registration_status = 'upcoming' where slug = 'replay-3';
```

- [ ] **Step 10: Cleanup smoke-test rows (optional but tidy)**

```sql
delete from registrations where user_phone in ('9000000001');
delete from leads where phone = '9000000002';
delete from users where phone in ('9000000001', '9000000002');
```

(Don't delete the real guild-member phone's `users` row — only the synthetic smoke ones.)

---

## Definition of Done

- [ ] `npm test` in `worker/` is green (~62 tests across 11 files).
- [ ] `wrangler deploy` succeeded; `https://api.replaycon.in/api/health` returns 200.
- [ ] All 5 new endpoints behave per spec in live smoke test (Task 14).
- [ ] `editions` table has the `replay-3` row with `is_current=true`, `is_published=false`, `registration_status='upcoming'`.
- [ ] Replay Apps Script `urls.replay-registration` points at `rebuild/phase-0` branch and the GAS web app has a new version deployed.
- [ ] All commits pushed to `origin/rebuild/phase-0`.

After all tasks: the worker layer for REPLAY 3 registration is complete and live, ready for Phase 1B to build the registration page on top.
