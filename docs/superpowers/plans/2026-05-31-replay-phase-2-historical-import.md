# REPLAY Phase 2 — Historical Edition Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import replay-1 + replay-2 pass registrations and replay-2 pre-orders from CSV exports into Supabase via an idempotent `tsx` script.

**Architecture:** A standalone TypeScript script (`scripts/import-historical.ts`) run with `tsx`, using `@supabase/supabase-js` with the service-role key. Pure parsing/mapping logic lives in `scripts/lib/` and is unit-tested with vitest. Two historical editions are seeded first via SQL. Idempotency comes from delete-by-edition-then-reinsert for registrations/orders (scoped to historical edition ids only) and upsert for users.

**Tech Stack:** TypeScript, tsx, vitest, `@supabase/supabase-js`, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-05-31-replay-phase-2-historical-import-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/csv.ts` | Robust CSV string → `Record<string,string>[]` parser (quotes, embedded commas/newlines). No I/O. |
| `scripts/lib/mappers.ts` | Pure CSV-row → DB-row mappers + small helpers (phone, status, day/pass, guild tier, channel, order items, pricing base). No I/O. |
| `scripts/import-historical.ts` | Orchestration + I/O: load env, read CSVs, resolve edition ids, upsert users, delete+insert registrations/orders, print summary, `--dry-run`. |
| `scripts/lib/mappers.test.ts` | Unit tests for mappers. |
| `scripts/lib/csv.test.ts` | Unit tests for the CSV parser. |
| `scripts/.env.example` | Documents the two env vars (committed; real `.env` gitignored). |
| `supabase/seeds/replay-1-2.sql` | Idempotent seed for the replay-1 + replay-2 edition rows. |
| `package.json` | Add `tsx` devDep + `import:historical` script. |
| `vitest.config.ts` | Extend `include` to cover `scripts/**/*.test.ts`. |
| `.gitignore` | Add `scripts/data/`. |

---

## Task 1: Project setup (deps, scripts, gitignore, env example)

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `scripts/.env.example`
- Create: `scripts/data/.gitkeep`

- [ ] **Step 1: Add `tsx` as a devDependency**

Run:
```bash
npm install --save-dev tsx@^4
```
Expected: `tsx` appears under `devDependencies` in `package.json`; install completes without pulling a new vite major (tsx has no vite dependency).

- [ ] **Step 2: Add the npm run script**

In `package.json`, inside `"scripts"`, add the `import:historical` line:
```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "test": "vitest run",
    "test:watch": "vitest",
    "import:historical": "tsx scripts/import-historical.ts"
  },
```

- [ ] **Step 3: Extend vitest include to cover scripts tests**

In `vitest.config.ts`, change the `include` array so scripts tests run with the root suite:
```ts
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
```
(Leave `environment: 'jsdom'` and `setupFiles` as-is — the scripts tests are pure functions and unaffected by the jsdom env.)

- [ ] **Step 4: Gitignore the raw CSV data dir**

Append to `.gitignore`:
```
scripts/data/
```

- [ ] **Step 5: Create the data dir placeholder and env example**

Create `scripts/data/.gitkeep` (empty file).

Create `scripts/.env.example`:
```
# Copy to scripts/.env (gitignored) and fill in. Service key bypasses RLS.
SUPABASE_URL=https://qvkynwlmzeybdiapbcsy.supabase.co
SUPABASE_SERVICE_KEY=
```

- [ ] **Step 6: Verify the test runner still passes with no new tests**

Run: `npm test`
Expected: existing 25 site tests still PASS (no scripts tests exist yet, so the new glob matches nothing).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .gitignore scripts/.env.example scripts/data/.gitkeep
git commit -m "Phase 2: scaffold historical import (tsx dep, scripts dir, env example)"
```

---

## Task 2: Seed the historical edition rows

**Files:**
- Create: `supabase/seeds/replay-1-2.sql`

- [ ] **Step 1: Write the seed SQL**

Create `supabase/seeds/replay-1-2.sql` (mirrors the idempotent pattern in `replay-3.sql` — never overwrites live flags on re-run):
```sql
-- supabase/seeds/replay-1-2.sql
-- Seeds the two historical REPLAY editions. Idempotent — safe to re-run.
-- replay-1: Jan 31 2026, single day, The Bangalore Local Koramangala, 50 seats, ₹800.
-- replay-2: Apr 18-19 2026, two day, same venue, 150 seats/day, ₹800/day or ₹1400 campaign.
-- Both ₹ totals include ₹200/day F&B cover at the venue.

insert into editions (
  slug, name, start_date, end_date, venue,
  capacity_per_day, pricing,
  registration_status, is_current, is_published
) values
(
  'replay-1',
  'REPLAY 1',
  '2026-01-31', '2026-01-31',
  'The Bangalore Local, Koramangala',
  '{"day1": 50}'::jsonb,
  '{"oneshot": {"day1": 800}, "campaign": null, "adventurer_cap": 1000}'::jsonb,
  'closed', false, true
),
(
  'replay-2',
  'REPLAY 2',
  '2026-04-18', '2026-04-19',
  'The Bangalore Local, Koramangala',
  '{"day1": 150, "day2": 150}'::jsonb,
  '{"oneshot": {"day1": 800, "day2": 800}, "campaign": 1400, "adventurer_cap": 1000}'::jsonb,
  'closed', false, true
)
on conflict (slug) do update set
  name             = excluded.name,
  start_date       = excluded.start_date,
  end_date         = excluded.end_date,
  venue            = excluded.venue,
  capacity_per_day = excluded.capacity_per_day,
  pricing          = excluded.pricing;
-- registration_status / is_current / is_published intentionally NOT overwritten.
```

- [ ] **Step 2: Apply the seed to Supabase**

Apply via the Supabase SQL editor (project `qvkynwlmzeybdiapbcsy`) or `psql`. Paste the file contents and run.
Expected: `INSERT 0 2` on first run (or `INSERT 0 2` with the update branch on re-run — no error).

- [ ] **Step 3: Verify both editions exist and are published**

Run this query in the SQL editor:
```sql
select slug, name, start_date, end_date, capacity_per_day, pricing, registration_status, is_published
from editions where slug in ('replay-1','replay-2') order by slug;
```
Expected: 2 rows, both `is_published = true`, `registration_status = 'closed'`, dates in 2026.

- [ ] **Step 4: Commit**

```bash
git add supabase/seeds/replay-1-2.sql
git commit -m "Phase 2: seed replay-1 and replay-2 edition rows"
```

---

## Task 3: CSV parser (`scripts/lib/csv.ts`)

**Files:**
- Create: `scripts/lib/csv.ts`
- Test: `scripts/lib/csv.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/csv.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const rows = parseCsv('a,b\n1,2\n3,4\n');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    const rows = parseCsv('name,detail\nChai,"a, b, c"\n');
    expect(rows[0]).toEqual({ name: 'Chai', detail: 'a, b, c' });
  });

  it('handles embedded newlines and escaped quotes inside quotes', () => {
    const csv = 'name,json\nP,"[{""x"":1},\n{""y"":2}]"\n';
    const rows = parseCsv(csv);
    expect(rows[0].name).toBe('P');
    expect(rows[0].json).toBe('[{"x":1},\n{"y":2}]');
  });

  it('trims header and cell whitespace and skips blank trailing lines', () => {
    const rows = parseCsv('a , b\n 1 , 2 \n\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/lib/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'` / `parseCsv is not a function`.

- [ ] **Step 3: Implement the parser**

Create `scripts/lib/csv.ts`:
```ts
// scripts/lib/csv.ts
// Minimal RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
// embedded newlines, and "" escaped quotes. Returns objects keyed by header.
// No I/O — operates on an already-read string.

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length === 1 && cells[0].trim() === '') continue; // blank line
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    out.push(obj);
  }
  return out;
}

function parseRows(text: string): string[][] {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (s.length === 0) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/lib/csv.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/csv.ts scripts/lib/csv.test.ts
git commit -m "Phase 2: add CSV parser for historical import"
```

---

## Task 4: Mappers (`scripts/lib/mappers.ts`)

**Files:**
- Create: `scripts/lib/mappers.ts`
- Test: `scripts/lib/mappers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/mappers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  sanitizePhone,
  parsePaymentStatus,
  parsePassAndDays,
  parseGuildTier,
  parseOrderItems,
  normalizeChannel,
  expectedBase,
  mapReplay1Registration,
  mapReplay2Registration,
  mapReplay2Order,
  type EditionPricing,
} from './mappers';

const R2_PRICING: EditionPricing = {
  oneshot: { day1: 800, day2: 800 },
  campaign: 1400,
  adventurer_cap: 1000,
};

describe('sanitizePhone', () => {
  it('keeps last 10 digits, stripping +91 and spaces', () => {
    expect(sanitizePhone('+91 98765 43210')).toBe('9876543210');
  });
  it('returns empty for too-short input', () => {
    expect(sanitizePhone('12345')).toBe('');
  });
  it('returns empty for non-string', () => {
    expect(sanitizePhone(undefined)).toBe('');
  });
});

describe('parsePaymentStatus', () => {
  it('maps Paid to confirmed', () => expect(parsePaymentStatus('Paid')).toBe('confirmed'));
  it('maps Cancelled (two L) to cancelled', () => expect(parsePaymentStatus('Cancelled')).toBe('cancelled'));
  it('maps Canceled (one L) to cancelled', () => expect(parsePaymentStatus('Canceled')).toBe('cancelled'));
  it('maps Pending to pending', () => expect(parsePaymentStatus('Pending')).toBe('pending'));
  it('defaults blank to pending', () => expect(parsePaymentStatus('')).toBe('pending'));
});

describe('parsePassAndDays', () => {
  it('maps One Shot + Saturday to oneshot day1', () => {
    expect(parsePassAndDays('One Shot (Day Pass)', 'Saturday, Apr 18')).toEqual({ pass_type: 'oneshot', days: ['day1'] });
  });
  it('maps One Shot + Sunday to oneshot day2', () => {
    expect(parsePassAndDays('One Shot (Day Pass)', 'Sunday, Apr 19')).toEqual({ pass_type: 'oneshot', days: ['day2'] });
  });
  it('maps Campaign + Both days to campaign both days', () => {
    expect(parsePassAndDays('Campaign (2-Day Pass)', 'Both days')).toEqual({ pass_type: 'campaign', days: ['day1', 'day2'] });
  });
});

describe('parseGuildTier', () => {
  it('parses Guildmaster', () => expect(parseGuildTier('Guildmaster (100% off)')).toBe('guildmaster'));
  it('parses Adventurer', () => expect(parseGuildTier('Adventurer (71% off)')).toBe('adventurer'));
  it('returns null for Credits Used', () => expect(parseGuildTier('150 Credits Used')).toBeNull());
  it('returns null for blank', () => expect(parseGuildTier('')).toBeNull());
});

describe('parseOrderItems', () => {
  it('parses a valid order array', () => {
    const raw = '[{"name":"Exploding Kittens","qty":1,"price":789}]';
    expect(parseOrderItems(raw)).toEqual([{ name: 'Exploding Kittens', qty: 1, price: 789 }]);
  });
  it('throws on malformed item', () => {
    expect(() => parseOrderItems('[{"name":"x"}]')).toThrow();
  });
  it('throws on non-array', () => {
    expect(() => parseOrderItems('{"name":"x"}')).toThrow();
  });
});

describe('normalizeChannel', () => {
  it('defaults to website', () => expect(normalizeChannel('Website')).toBe('website'));
  it('detects swiggy', () => expect(normalizeChannel('Swiggy')).toBe('swiggy'));
  it('detects whatsaround', () => expect(normalizeChannel('WhatsAround')).toBe('whatsaround'));
});

describe('expectedBase', () => {
  it('oneshot single day times seats', () => {
    expect(expectedBase(R2_PRICING, 'oneshot', ['day1'], 2)).toBe(1600);
  });
  it('campaign uses campaign price times seats', () => {
    expect(expectedBase(R2_PRICING, 'campaign', ['day1', 'day2'], 1)).toBe(1400);
  });
});

describe('mapReplay1Registration', () => {
  it('maps a paid single-day row', () => {
    const row = { Timestamp: '2026-01-26 10:56:08', 'Phone Number': '8879621486', Name: 'Aalhad', Status: 'Paid', Seats: '1', Paid: '800' };
    const out = mapReplay1Registration(row)!;
    expect(out.user).toEqual({ phone: '8879621486', name: 'Aalhad', email: null });
    expect(out.registration).toMatchObject({
      user_phone: '8879621486', pass_type: 'oneshot', days: ['day1'], seats: 1,
      amount_paid: 800, discount_applied: 0, guild_tier_at_purchase: null,
      payment_status: 'confirmed', source: { channel: 'website' },
    });
  });
  it('returns null for an unparseable phone', () => {
    expect(mapReplay1Registration({ 'Phone Number': 'NA', Name: 'x', Status: 'Paid', Seats: '1', Paid: '800' })).toBeNull();
  });
});

describe('mapReplay2Registration', () => {
  it('maps a campaign row with adventurer discount', () => {
    const row = { Name: 'Chai', Phone: '7898847988', Email: 'c@x.com', 'Pass Type': 'Campaign (2-Day Pass)', Day: 'Both days', Quantity: '1', Paid: '400', Discount: 'Adventurer (71% off)', 'Payment Status': 'Paid', 'Seats used': '2', Source: 'Website' };
    const out = mapReplay2Registration(row, R2_PRICING)!;
    expect(out.user).toEqual({ phone: '7898847988', name: 'Chai', email: 'c@x.com' });
    expect(out.registration).toMatchObject({
      pass_type: 'campaign', days: ['day1', 'day2'], seats: 1, amount_paid: 400,
      discount_applied: 1000, guild_tier_at_purchase: 'adventurer',
      payment_status: 'confirmed', source: { channel: 'website' },
    });
  });
  it('uses Quantity not Seats used for seats', () => {
    const row = { Name: 'X', Phone: '9000000000', Email: '', 'Pass Type': 'Campaign (2-Day Pass)', Day: 'Both days', Quantity: '1', Paid: '1400', Discount: '', 'Payment Status': 'Paid', 'Seats used': '2', Source: 'Website' };
    const out = mapReplay2Registration(row, R2_PRICING)!;
    expect(out.registration.seats).toBe(1);
    expect(out.registration.discount_applied).toBe(0);
  });
});

describe('mapReplay2Order', () => {
  it('maps an order row with parsed items', () => {
    const row = { Name: 'Pratik', Phone: '7742251441', Email: 'p@x.com', 'Order Details': '[{"name":"Forest Friends","qty":1,"price":399}]', 'Amount paid': '399', 'Payment Status': 'Paid' };
    const out = mapReplay2Order(row)!;
    expect(out.user.phone).toBe('7742251441');
    expect(out.order).toMatchObject({
      user_phone: '7742251441', total: 399, payment_status: 'confirmed', source: { channel: 'website' },
      items: [{ name: 'Forest Friends', qty: 1, price: 399 }],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/lib/mappers.test.ts`
Expected: FAIL — `Cannot find module './mappers'`.

- [ ] **Step 3: Implement the mappers**

Create `scripts/lib/mappers.ts`:
```ts
// scripts/lib/mappers.ts
// Pure CSV-row -> DB-row mappers + helpers. No I/O, no env access.

export type PaymentStatus = 'confirmed' | 'cancelled' | 'pending';
export type PassType = 'oneshot' | 'campaign';
export type Day = 'day1' | 'day2';
export type GuildTier = 'initiate' | 'adventurer' | 'guildmaster';
export type Channel = 'website' | 'whatsaround' | 'swiggy';

export interface EditionPricing {
  oneshot: { day1?: number; day2?: number };
  campaign: number | null;
  adventurer_cap?: number;
}

export interface UserUpsert {
  phone: string;
  name: string | null;
  email: string | null;
}

export interface RegistrationInsert {
  user_phone: string;
  pass_type: PassType;
  days: Day[];
  seats: number;
  amount_paid: number;
  discount_applied: number;
  guild_tier_at_purchase: GuildTier | null;
  payment_status: PaymentStatus;
  source: { channel: Channel };
}

export interface OrderItem { name: string; qty: number; price: number; }

export interface OrderInsert {
  user_phone: string;
  items: OrderItem[];
  total: number;
  payment_status: PaymentStatus;
  source: { channel: Channel };
}

// Ported from worker/src/validation.ts — strip non-digits, require >=10, take last 10.
export function sanitizePhone(input: unknown): string {
  if (typeof input !== 'string') return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export function parsePaymentStatus(raw: string): PaymentStatus {
  const v = (raw ?? '').trim().toLowerCase();
  if (v.startsWith('cancel')) return 'cancelled';
  if (v === 'paid' || v === 'confirmed') return 'confirmed';
  if (v === 'pending') return 'pending';
  return 'pending'; // unknown/blank -> pending (excluded from confirmed counts)
}

export function parsePassAndDays(passTypeRaw: string, dayRaw: string): { pass_type: PassType; days: Day[] } {
  const pass = (passTypeRaw ?? '').toLowerCase();
  const day = (dayRaw ?? '').toLowerCase();
  const pass_type: PassType = pass.includes('campaign') ? 'campaign' : 'oneshot';
  let days: Day[];
  if (day.includes('both')) days = ['day1', 'day2'];
  else if (day.includes('apr 18') || day.includes('saturday')) days = ['day1'];
  else if (day.includes('apr 19') || day.includes('sunday')) days = ['day2'];
  else days = pass_type === 'campaign' ? ['day1', 'day2'] : ['day1'];
  return { pass_type, days };
}

export function parseGuildTier(discountText: string): GuildTier | null {
  const v = (discountText ?? '').toLowerCase();
  if (v.includes('guildmaster')) return 'guildmaster';
  if (v.includes('adventurer')) return 'adventurer';
  if (v.includes('initiate')) return 'initiate';
  return null;
}

export function parseOrderItems(raw: string): OrderItem[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('order items not an array');
  return parsed.map((it: any) => {
    if (typeof it?.name !== 'string' || typeof it?.qty !== 'number' || typeof it?.price !== 'number') {
      throw new Error('malformed order item');
    }
    return { name: it.name, qty: it.qty, price: it.price };
  });
}

export function normalizeChannel(source: string): Channel {
  const v = (source ?? '').toLowerCase();
  if (v.includes('swiggy')) return 'swiggy';
  if (v.includes('whataround') || v.includes('whatsaround')) return 'whatsaround';
  return 'website';
}

export function expectedBase(pricing: EditionPricing, pass_type: PassType, days: Day[], seats: number): number {
  let perPass: number;
  if (pass_type === 'campaign') {
    perPass = pricing.campaign ?? 0;
  } else {
    perPass = days.reduce((sum, d) => sum + (pricing.oneshot[d] ?? 0), 0);
  }
  return perPass * seats;
}

function toInt(raw: string, fallback: number): number {
  const n = parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toAmount(raw: string): number {
  const n = parseFloat((raw ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function mapReplay1Registration(row: Record<string, string>):
  { user: UserUpsert; registration: RegistrationInsert } | null {
  const phone = sanitizePhone(row['Phone Number']);
  if (!phone) return null;
  return {
    user: { phone, name: row['Name'] || null, email: null },
    registration: {
      user_phone: phone,
      pass_type: 'oneshot',
      days: ['day1'],
      seats: toInt(row['Seats'], 1),
      amount_paid: toAmount(row['Paid']),
      discount_applied: 0,
      guild_tier_at_purchase: null,
      payment_status: parsePaymentStatus(row['Status']),
      source: { channel: 'website' },
    },
  };
}

export function mapReplay2Registration(row: Record<string, string>, pricing: EditionPricing):
  { user: UserUpsert; registration: RegistrationInsert } | null {
  const phone = sanitizePhone(row['Phone']);
  if (!phone) return null;
  const { pass_type, days } = parsePassAndDays(row['Pass Type'], row['Day']);
  const seats = toInt(row['Quantity'], 1);
  const amount_paid = toAmount(row['Paid']);
  const base = expectedBase(pricing, pass_type, days, seats);
  return {
    user: { phone, name: row['Name'] || null, email: row['Email'] || null },
    registration: {
      user_phone: phone,
      pass_type,
      days,
      seats,
      amount_paid,
      discount_applied: Math.max(0, base - amount_paid),
      guild_tier_at_purchase: parseGuildTier(row['Discount']),
      payment_status: parsePaymentStatus(row['Payment Status']),
      source: { channel: normalizeChannel(row['Source']) },
    },
  };
}

export function mapReplay2Order(row: Record<string, string>):
  { user: UserUpsert; order: OrderInsert } | null {
  const phone = sanitizePhone(row['Phone']);
  if (!phone) return null;
  const items = parseOrderItems(row['Order Details']); // throws on malformed
  return {
    user: { phone, name: row['Name'] || null, email: row['Email'] || null },
    order: {
      user_phone: phone,
      items,
      total: toAmount(row['Amount paid']),
      payment_status: parsePaymentStatus(row['Payment Status']),
      source: { channel: 'website' },
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/lib/mappers.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/mappers.ts scripts/lib/mappers.test.ts
git commit -m "Phase 2: add pure CSV-row mappers for historical import"
```

---

## Task 5: Orchestration script (`scripts/import-historical.ts`)

**Files:**
- Create: `scripts/import-historical.ts`

This file is I/O + orchestration only (no unit test; correctness verified by `--dry-run` in Task 6). It reuses the tested `parseCsv` + mappers.

- [ ] **Step 1: Write the script**

Create `scripts/import-historical.ts`:
```ts
// scripts/import-historical.ts
// One-off, idempotent import of replay-1 + replay-2 history into Supabase.
// Run: npm run import:historical [-- --dry-run]
// Requires scripts/.env (or process env) with SUPABASE_URL + SUPABASE_SERVICE_KEY.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseCsv } from './lib/csv';
import {
  mapReplay1Registration,
  mapReplay2Registration,
  mapReplay2Order,
  type EditionPricing,
  type UserUpsert,
  type RegistrationInsert,
  type OrderInsert,
  type PaymentStatus,
} from './lib/mappers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const DRY_RUN = process.argv.includes('--dry-run');
const ALLOWED_SLUGS = ['replay-1', 'replay-2'] as const;

const REPLAY2_PRICING: EditionPricing = {
  oneshot: { day1: 800, day2: 800 },
  campaign: 1400,
  adventurer_cap: 1000,
};

function loadEnv(): void {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

function readCsv(file: string): Record<string, string>[] {
  const path = resolve(DATA_DIR, file);
  if (!existsSync(path)) {
    console.error(`Missing CSV: ${path}`);
    process.exit(1);
  }
  return parseCsv(readFileSync(path, 'utf8'));
}

// Merge user records by phone, keeping the first non-empty name/email seen.
function mergeUsers(target: Map<string, UserUpsert>, users: UserUpsert[]): void {
  for (const u of users) {
    const existing = target.get(u.phone);
    if (!existing) {
      target.set(u.phone, { ...u });
    } else {
      if (!existing.name && u.name) existing.name = u.name;
      if (!existing.email && u.email) existing.email = u.email;
    }
  }
}

function statusSplit(items: { payment_status: PaymentStatus }[]): string {
  const c = { confirmed: 0, cancelled: 0, pending: 0 };
  for (const it of items) c[it.payment_status]++;
  return `confirmed=${c.confirmed} cancelled=${c.cancelled} pending=${c.pending}`;
}

async function upsertUsers(sb: SupabaseClient, users: Map<string, UserUpsert>): Promise<void> {
  const rows = [...users.values()];
  if (rows.length === 0) return;
  const { error } = await sb.from('users').upsert(rows, { onConflict: 'phone' });
  if (error) throw new Error(`users upsert: ${error.message}`);
}

async function reloadRegistrations(
  sb: SupabaseClient,
  editionId: string,
  regs: RegistrationInsert[],
): Promise<void> {
  const del = await sb.from('registrations').delete().eq('edition_id', editionId);
  if (del.error) throw new Error(`registrations delete: ${del.error.message}`);
  if (regs.length === 0) return;
  const rows = regs.map((r) => ({ ...r, edition_id: editionId }));
  const { error } = await sb.from('registrations').insert(rows);
  if (error) throw new Error(`registrations insert: ${error.message}`);
}

async function reloadOrders(
  sb: SupabaseClient,
  editionId: string,
  orders: OrderInsert[],
): Promise<void> {
  const del = await sb.from('orders').delete().eq('edition_id', editionId);
  if (del.error) throw new Error(`orders delete: ${del.error.message}`);
  if (orders.length === 0) return;
  const rows = orders.map((o) => ({ ...o, edition_id: editionId }));
  const { error } = await sb.from('orders').insert(rows);
  if (error) throw new Error(`orders insert: ${error.message}`);
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (set scripts/.env).');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Resolve historical edition ids by slug (guard: only these slugs are touched).
  const { data: eds, error } = await sb.from('editions').select('id, slug').in('slug', ALLOWED_SLUGS as unknown as string[]);
  if (error) throw new Error(`editions lookup: ${error.message}`);
  const idBySlug = new Map((eds ?? []).map((e: any) => [e.slug, e.id as string]));
  for (const slug of ALLOWED_SLUGS) {
    if (!idBySlug.has(slug)) {
      console.error(`Edition ${slug} not found. Apply supabase/seeds/replay-1-2.sql first.`);
      process.exit(1);
    }
  }

  console.log(DRY_RUN ? '== DRY RUN (no writes) ==' : '== LIVE IMPORT ==');

  // ---- Parse all CSVs ----
  const r1Rows = readCsv('replay-1-registrations.csv');
  const r2Rows = readCsv('replay-2-registrations.csv');
  const r2OrderRows = readCsv('replay-2-preorders.csv');

  const users = new Map<string, UserUpsert>();
  const skipped: string[] = [];

  // replay-1 registrations
  const r1Regs: RegistrationInsert[] = [];
  const r1Users: UserUpsert[] = [];
  r1Rows.forEach((row, idx) => {
    const m = mapReplay1Registration(row);
    if (!m) { skipped.push(`replay-1 reg line ${idx + 2}: bad phone "${row['Phone Number']}"`); return; }
    r1Users.push(m.user);
    r1Regs.push(m.registration);
  });
  mergeUsers(users, r1Users);

  // replay-2 registrations
  const r2Regs: RegistrationInsert[] = [];
  const r2Users: UserUpsert[] = [];
  r2Rows.forEach((row, idx) => {
    const m = mapReplay2Registration(row, REPLAY2_PRICING);
    if (!m) { skipped.push(`replay-2 reg line ${idx + 2}: bad phone "${row['Phone']}"`); return; }
    r2Users.push(m.user);
    r2Regs.push(m.registration);
  });
  mergeUsers(users, r2Users);

  // replay-2 orders
  const r2Orders: OrderInsert[] = [];
  const r2OrderUsers: UserUpsert[] = [];
  r2OrderRows.forEach((row, idx) => {
    try {
      const m = mapReplay2Order(row);
      if (!m) { skipped.push(`replay-2 order line ${idx + 2}: bad phone "${row['Phone']}"`); return; }
      r2OrderUsers.push(m.user);
      r2Orders.push(m.order);
    } catch (e) {
      skipped.push(`replay-2 order line ${idx + 2}: ${(e as Error).message}`);
    }
  });
  mergeUsers(users, r2OrderUsers);

  // ---- Summary ----
  console.log(`\nParsed:`);
  console.log(`  users (deduped):        ${users.size}`);
  console.log(`  replay-1 registrations: ${r1Regs.length} (${statusSplit(r1Regs)})`);
  console.log(`  replay-2 registrations: ${r2Regs.length} (${statusSplit(r2Regs)})`);
  console.log(`  replay-2 orders:        ${r2Orders.length} (${statusSplit(r2Orders)})`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} row(s):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete — no rows written.');
    return;
  }

  // ---- Write ----
  await upsertUsers(sb, users);
  await reloadRegistrations(sb, idBySlug.get('replay-1')!, r1Regs);
  await reloadRegistrations(sb, idBySlug.get('replay-2')!, r2Regs);
  await reloadOrders(sb, idBySlug.get('replay-2')!, r2Orders);

  console.log('\nImport complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check the script compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `scripts/`. (If `tsconfig.json` excludes `scripts/`, run `npx tsx --check scripts/import-historical.ts` instead, or simply rely on the dry-run in Task 6 to surface type/runtime issues.)

- [ ] **Step 3: Commit**

```bash
git add scripts/import-historical.ts
git commit -m "Phase 2: add historical import orchestration script"
```

---

## Task 6: Dry-run, then live import against the real CSVs

**Files:** none (operational task). Requires the three CSVs present in `scripts/data/` and `scripts/.env` filled in.

- [ ] **Step 1: Confirm inputs are in place**

Run: `ls scripts/data/`
Expected: `replay-1-registrations.csv`, `replay-2-registrations.csv`, `replay-2-preorders.csv` present.
(If the organiser's files have different names, rename them to match — the script reads these exact filenames.)

- [ ] **Step 2: Confirm env is set**

Ensure `scripts/.env` exists with `SUPABASE_URL` and a valid `SUPABASE_SERVICE_KEY` (copy from `scripts/.env.example`; the service key is the worker's `SUPABASE_SERVICE_KEY` — retrievable via `cd worker && npx wrangler secret list` is name-only, so get the value from the Supabase dashboard → Project Settings → API → service_role key).

- [ ] **Step 3: Dry run**

Run: `npm run import:historical -- --dry-run`
Expected output: `== DRY RUN (no writes) ==`, a parsed summary with non-zero registration counts (~50 for replay-1, ~102 for replay-2, ~12 orders), a sensible confirmed/cancelled split, and a (hopefully empty) skip list. Review the skip list — every skipped row should be a genuinely bad record, not a parsing bug.

- [ ] **Step 4: Live import**

Run: `npm run import:historical`
Expected: same summary, then `Import complete.` with no errors.

- [ ] **Step 5: Verify row counts in Supabase**

Run in the Supabase SQL editor:
```sql
select e.slug, count(*) filter (where r.id is not null) as registrations
from editions e left join registrations r on r.edition_id = e.id
where e.slug in ('replay-1','replay-2') group by e.slug order by e.slug;

select count(*) as orders from orders o
join editions e on e.id = o.edition_id where e.slug = 'replay-2';

-- Sanity: confirmed seat-days per day for replay-2 (matches capacity model).
select unnest(r.days) as day, sum(r.seats) as seat_days
from registrations r join editions e on e.id = r.edition_id
where e.slug = 'replay-2' and r.payment_status = 'confirmed'
group by 1 order by 1;
```
Expected: replay-1 registrations ≈ rows minus any skipped; replay-2 likewise; orders ≈ 12. Seat-day totals per day are ≤ capacity (150) and look plausible.

- [ ] **Step 6: Re-run to prove idempotency**

Run: `npm run import:historical`
Then re-run the verification query from Step 5.
Expected: identical counts (no duplication) — the delete-then-insert reload produced the same state.

---

## Task 7: Document learnings and mark phase status

**Files:**
- Modify: `CLAUDE.md` (append a session learning)
- Modify: `docs/superpowers/HANDOFF.md` (move Phase 2 from pending → shipped)

- [ ] **Step 1: Append a learning to CLAUDE.md**

Under `### Session learnings`, append (use today's date):
```markdown
- 2026-05-31 — Phase 2 historical import shipped: `scripts/import-historical.ts` (run via `npm run import:historical`, `tsx`) loads replay-1/replay-2 registrations + replay-2 orders from gitignored `scripts/data/*.csv` into Supabase. Idempotent via delete-by-edition + reinsert (scoped to historical edition ids only — never touches replay-3); users upserted by phone. Pure mappers in `scripts/lib/mappers.ts` are unit-tested. **Why it matters:** `seats` = qty purchased (passes), NOT the legacy `Seats used` seat-days column — capacity is derived by expanding over `days[]` in `getConfirmedSeatsByDay`, so mapping `Seats used` would double-count campaign passes. Historical `discount_applied` is a cause-agnostic gross number (`base − paid`); credit-vs-guild split isn't recoverable from the source CSVs.
```

- [ ] **Step 2: Update HANDOFF.md phase status**

In `docs/superpowers/HANDOFF.md`, move the `### Phase 2 — historical edition import` entry from "Phases pending" into the "Phases shipped" table (or annotate it shipped with today's date), noting the script path, the seed file `supabase/seeds/replay-1-2.sql`, and that CSVs live gitignored in `scripts/data/`. Update "Last updated" to 2026-05-31.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: existing site tests PASS plus the new `scripts/**` tests (csv + mappers) PASS.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/HANDOFF.md
git commit -m "Phase 2: log learnings + mark historical import shipped"
```

---

## Notes for the implementer

- **PII discipline:** the CSVs and `scripts/.env` are gitignored. Never `git add -f` them, never paste attendee rows into commit messages or this repo's docs.
- **Order of operations matters:** Task 2 (seed editions) MUST run before Task 6 (import), or the edition-id lookup aborts the script by design.
- **Re-running is safe** for replay-1/replay-2 only. The script hard-guards on those two slugs; it cannot delete replay-3 rows.
- **If a dry-run skip list is non-empty,** inspect each line before the live run — a bad phone is fine to skip, but a malformed-order-JSON skip might mean the CSV export quoting got mangled and needs re-exporting.
```
