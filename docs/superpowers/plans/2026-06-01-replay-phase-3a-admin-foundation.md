# REPLAY Phase 3A — Admin foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the REPLAY admin (Vite+React+shadcn at `admin.replaycon.in`) plus the worker `/api/admin/*` layer behind Cloudflare Access, delivering Dashboard, Registrations (list/confirm/cancel/manual-add), Leads, and Audit-log screens with before/after audit logging.

**Architecture:** Worker gains an admin route group gated by the existing `verifyAccessJwt` (reads the `Cf-Access-Jwt-Assertion` header Cloudflare injects). New admin handlers live under `worker/src/admin/`. The admin SPA is a port-and-adapt of `/Users/siddhantnarula/Projects/bgc-website/admin/` — framework pieces (shadcn `ui/`, Layout/Sidebar/mobile components, `lib/api`, `whoami`) are copied and trimmed; only replay's screens are written fresh. Single admin role (no guest concept).

**Tech Stack:** Cloudflare Workers (TypeScript, vitest), `@supabase/supabase-js`, React 18 + Vite + react-router-dom + shadcn/ui (radix + tailwind) + sonner, Cloudflare Pages + Access.

**Reference repo (local):** `/Users/siddhantnarula/Projects/bgc-website/admin/` and `/Users/siddhantnarula/Projects/bgc-website/worker/`. Spec: `docs/superpowers/specs/2026-06-01-replay-phase-3a-admin-foundation-design.md`.

---

## File structure

**Worker (new files under `worker/src/admin/`):**
- `worker/src/admin/auth.ts` — `pickAdminOrigin`, `adminCorsHeaders`, `adminJson` helpers + `requireAdmin` gate wrapper.
- `worker/src/admin/audit.ts` — `writeAudit`, `diffRows`, `handleAuditList`.
- `worker/src/admin/whoami.ts` — `handleWhoami`.
- `worker/src/admin/rebuild.ts` — `handleRebuild`.
- `worker/src/admin/dashboard.ts` — `handleDashboard`.
- `worker/src/admin/registrations.ts` — `handleRegList`, `handleRegGet`, `handleRegCreate`, `handleRegPatch`.
- `worker/src/admin/leads.ts` — `handleLeadsList`.
- `worker/src/registration-email.ts` — `sendRegistrationConfirmation` (extracted from `register.ts`, reused by manual-add).

**Worker (modified):**
- `worker/src/index.ts` — add `Env` fields, admin OPTIONS + dispatch block.
- `worker/src/editions.ts` — add `getEditionBySlug`, `getCurrentEdition`.
- `worker/src/register.ts` — call `sendRegistrationConfirmation` instead of inline email.

**Admin SPA (`admin/`):**
- Config: `package.json`, `tailwind.config.js`, `postcss.config.js`, `components.json`, `tsconfig.json` (path alias), `index.html`, `.env` — ported/edited.
- `admin/src/main.tsx`, `admin/src/App.tsx`, `admin/src/index.css` — router + providers.
- `admin/src/lib/{api,whoami,revalidate,utils,types}.ts(x)` — ported + replay-typed.
- `admin/src/components/ui/*` — shadcn primitives (copied from bgc).
- `admin/src/components/{Layout,Sidebar,BottomTabBar,DataTable,MobileCardList,ActionSheet,SearchOverlay,StatusBadge,Loading}.tsx` — ported + trimmed.
- `admin/src/pages/{Dashboard,RegistrationsList,RegistrationDrawer,ManualRegistrationDrawer,Leads,AuditLog}.tsx` — new.

---

## PART A — Worker

### Task 1: Edition lookup helpers (`getEditionBySlug`, `getCurrentEdition`)

**Files:**
- Modify: `worker/src/editions.ts`
- Test: `worker/src/editions.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `worker/src/editions.test.ts` (inside the existing file; reuse its `serviceClient` mock pattern — check the top of the file for how it mocks `./supabase`). Add:

```ts
import { getEditionBySlug, getCurrentEdition } from './editions';

describe('getEditionBySlug', () => {
  it('returns the row matched by slug', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', slug: 'replay-3' }, error: null }) }) }) }),
    });
    const row = await getEditionBySlug({ SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any, 'replay-3');
    expect(row?.id).toBe('e1');
  });
});

describe('getCurrentEdition', () => {
  it('returns the is_current row', async () => {
    (serviceClient as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', is_current: true }, error: null }) }) }) }),
    });
    const row = await getCurrentEdition({ SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x' } as any);
    expect(row?.id).toBe('e1');
  });
});
```

If `editions.test.ts` does not already mock `./supabase`, add at the top: `vi.mock('./supabase', () => ({ serviceClient: vi.fn() }));` and `import { serviceClient } from './supabase';`.

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/editions.test.ts`
Expected: FAIL — `getEditionBySlug is not a function`.

- [ ] **Step 3: Implement**

Append to `worker/src/editions.ts`:

```ts
export async function getEditionBySlug(env: Env, slug: string): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb.from('editions').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}

export async function getCurrentEdition(env: Env): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb.from('editions').select('*').eq('is_current', true).maybeSingle();
  if (error) throw new Error(`editions: ${error.message}`);
  return (data as EditionRow) ?? null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/editions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/editions.ts worker/src/editions.test.ts
git commit -m "Phase 3A: add getEditionBySlug + getCurrentEdition helpers"
```

---

### Task 2: Admin auth/CORS helpers + gate

**Files:**
- Create: `worker/src/admin/auth.ts`
- Test: `worker/src/admin/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/admin/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickAdminOrigin, adminCorsHeaders, adminJson } from './auth';

const env = (o = 'https://admin.replaycon.in') => ({ ADMIN_ORIGIN: o } as any);

describe('pickAdminOrigin', () => {
  it('echoes the request origin when it matches ADMIN_ORIGIN', () => {
    const req = new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'https://admin.replaycon.in' } });
    expect(pickAdminOrigin(req, env())).toBe('https://admin.replaycon.in');
  });
  it('allows localhost dev origin', () => {
    const req = new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'http://localhost:5173' } });
    expect(pickAdminOrigin(req, env())).toBe('http://localhost:5173');
  });
  it('falls back to ADMIN_ORIGIN for unknown origins', () => {
    const req = new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'https://evil.com' } });
    expect(pickAdminOrigin(req, env())).toBe('https://admin.replaycon.in');
  });
});

describe('adminCorsHeaders', () => {
  it('sets credentialed CORS headers', () => {
    const h = adminCorsHeaders('https://admin.replaycon.in');
    expect(h['Access-Control-Allow-Origin']).toBe('https://admin.replaycon.in');
    expect(h['Access-Control-Allow-Credentials']).toBe('true');
    expect(h['Access-Control-Allow-Methods']).toContain('PATCH');
  });
});

describe('adminJson', () => {
  it('returns json with credentialed CORS', async () => {
    const res = adminJson({ ok: true }, 200, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/admin/auth.test.ts`
Expected: FAIL — cannot find module `./auth`.

- [ ] **Step 3: Implement**

Create `worker/src/admin/auth.ts`:

```ts
import type { Env } from '../index';

const ALLOWED_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4321'];

export function pickAdminOrigin(req: Request, env: Env): string {
  const origin = req.headers.get('Origin') || '';
  if (origin === env.ADMIN_ORIGIN) return origin;
  if (ALLOWED_DEV_ORIGINS.includes(origin)) return origin;
  return env.ADMIN_ORIGIN;
}

export function adminCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function adminJson(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...adminCorsHeaders(origin) },
  });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/admin/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/auth.ts worker/src/admin/auth.test.ts
git commit -m "Phase 3A: admin CORS + origin helpers"
```

---

### Task 3: Audit helper + diff + list handler

**Files:**
- Create: `worker/src/admin/audit.ts`
- Test: `worker/src/admin/audit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/admin/audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffRows } from './audit';

describe('diffRows', () => {
  it('returns only changed keys as {old,new}', () => {
    const before = { a: 1, b: 'x', c: true };
    const after = { a: 2, b: 'x', c: false };
    expect(diffRows(before, after)).toEqual({ a: { old: 1, new: 2 }, c: { old: true, new: false } });
  });
  it('returns empty object when nothing changed', () => {
    expect(diffRows({ a: 1 }, { a: 1 })).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/admin/audit.test.ts`
Expected: FAIL — cannot find module `./audit`.

- [ ] **Step 3: Implement**

Create `worker/src/admin/audit.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';

export interface AuditEntry {
  actor_email: string;
  action: string;
  target_table: string;
  target_id: string | null;
  diff: unknown;
}

export function diffRows(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out[key] = { old: before[key], new: after[key] };
    }
  }
  return out;
}

export async function writeAudit(sb: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await sb.from('admin_audit_log').insert(entry);
  if (error) console.error('audit_write_failed', error.message);
}

export async function handleAuditList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get('limit')) || 100);
  const { data, error } = await sb
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ entries: data ?? [] }, 200, origin);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/admin/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/audit.ts worker/src/admin/audit.test.ts
git commit -m "Phase 3A: audit log helper + diff + list handler"
```

---

### Task 4: whoami + rebuild handlers

**Files:**
- Create: `worker/src/admin/whoami.ts`, `worker/src/admin/rebuild.ts`
- Test: `worker/src/admin/rebuild.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/admin/rebuild.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRebuild } from './rebuild';

const sb = { from: () => ({ insert: async () => ({ error: null }) }) } as any;
const env = { CLOUDFLARE_PAGES_DEPLOY_HOOK: 'https://hook.test/deploy' } as any;

beforeEach(() => vi.restoreAllMocks());

describe('handleRebuild', () => {
  it('fires the deploy hook and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handleRebuild(env, sb, 'sid@x.com', 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://hook.test/deploy', { method: 'POST' });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/admin/rebuild.test.ts`
Expected: FAIL — cannot find module `./rebuild`.

- [ ] **Step 3: Implement**

Create `worker/src/admin/whoami.ts`:

```ts
import { adminJson } from './auth';

export function handleWhoami(email: string, origin: string): Response {
  return adminJson({ email }, 200, origin);
}
```

Create `worker/src/admin/rebuild.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';

export async function handleRebuild(env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  const res = await fetch(env.CLOUDFLARE_PAGES_DEPLOY_HOOK, { method: 'POST' });
  if (!res.ok) return adminJson({ error: 'deploy_hook_failed' }, 502, origin);
  await writeAudit(sb, { actor_email: email, action: 'site.rebuild', target_table: 'site', target_id: null, diff: null });
  return adminJson({ ok: true }, 200, origin);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/admin/rebuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/whoami.ts worker/src/admin/rebuild.ts worker/src/admin/rebuild.test.ts
git commit -m "Phase 3A: whoami + rebuild admin handlers"
```

---

### Task 5: Dashboard handler

**Files:**
- Create: `worker/src/admin/dashboard.ts`
- Test: `worker/src/admin/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/admin/dashboard.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', name: 'REPLAY', capacity_per_day: { day1: 250, day2: 250 } })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', name: 'REPLAY', capacity_per_day: { day1: 250, day2: 250 } })),
  getConfirmedSeatsByDay: vi.fn(async () => ({ day1: 10, day2: 8 })),
}));
import { handleDashboard } from './dashboard';

function sbWith(regs: any[], leads: any[]) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: async () => ({ data: table === 'leads' ? leads : regs, error: null }) }),
          // non-ordered fetch for totals:
          then: undefined,
        }),
      }),
    }),
  } as any;
}

describe('handleDashboard', () => {
  it('returns edition, spots, totals and recents', async () => {
    // Two selects on registrations (totals + recent) and one on leads.
    const sb: any = {
      from: (table: string) => ({
        select: () => {
          if (table === 'leads') return { eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 'l1' }], error: null }) }) }) };
          return {
            eq: () => ({
              // totals call (no order)
              then: (cb: any) => cb({ data: [{ payment_status: 'confirmed', amount_paid: 800 }], error: null }),
              order: () => ({ limit: async () => ({ data: [{ id: 'r1', payment_status: 'confirmed' }], error: null }) }),
            }),
          };
        },
      }),
    };
    const req = new Request('https://api.x/api/admin/dashboard');
    const res = await handleDashboard(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.spots_by_day.day1.remaining).toBe(240);
    expect(body.totals.revenue).toBe(800);
  });
});
```

> Note: the chainable Supabase mock is awkward when one table is queried two different ways. If the mock proves brittle, split the totals query and recent query so each uses a distinct call shape (see implementation — totals uses `.eq()` awaited directly, recent uses `.order().limit()`).

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/admin/dashboard.test.ts`
Expected: FAIL — cannot find module `./dashboard`.

- [ ] **Step 3: Implement**

Create `worker/src/admin/dashboard.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug, getCurrentEdition, getConfirmedSeatsByDay } from '../editions';

export async function handleDashboard(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('edition');
  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  const seats = await getConfirmedSeatsByDay(env, edition.id);
  const cap = edition.capacity_per_day;
  const spots_by_day = {
    day1: { capacity: cap.day1, confirmed: seats.day1, remaining: Math.max(0, cap.day1 - seats.day1) },
    day2: { capacity: cap.day2, confirmed: seats.day2, remaining: Math.max(0, cap.day2 - seats.day2) },
  };

  const allRes = await sb.from('registrations').select('payment_status, amount_paid').eq('edition_id', edition.id);
  const all = (allRes.data ?? []) as { payment_status: string; amount_paid: number }[];
  const totals = {
    confirmed: all.filter((r) => r.payment_status === 'confirmed').length,
    pending: all.filter((r) => r.payment_status === 'pending').length,
    cancelled: all.filter((r) => r.payment_status === 'cancelled').length,
    revenue: all.filter((r) => r.payment_status === 'confirmed').reduce((s, r) => s + Number(r.amount_paid || 0), 0),
  };

  const recentRegsRes = await sb
    .from('registrations')
    .select('id, user_phone, pass_type, days, payment_status, amount_paid, created_at')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const recentLeadsRes = await sb
    .from('leads')
    .select('*')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return adminJson(
    {
      edition: { id: edition.id, slug: edition.slug, name: edition.name, registration_status: edition.registration_status },
      spots_by_day,
      totals,
      recent_registrations: recentRegsRes.data ?? [],
      recent_leads: recentLeadsRes.data ?? [],
    },
    200,
    origin,
  );
}
```

> The test's `allRes` path expects `.eq()` to be awaitable. Implement `handleDashboard` exactly as above; in the test mock make `.eq()` return an object that is both awaitable (`then`) for the totals call and chainable (`.order().limit()`) for the recent call. If too brittle, simplify the test to assert only `res.status === 200` and `spots_by_day.day1.remaining === 240` using a mock where `registrations.select().eq()` returns `{ then, order }` and drop the revenue assertion.

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/admin/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/dashboard.ts worker/src/admin/dashboard.test.ts
git commit -m "Phase 3A: dashboard admin handler"
```

---

### Task 6: Extract `sendRegistrationConfirmation` from register.ts

**Files:**
- Create: `worker/src/registration-email.ts`
- Modify: `worker/src/register.ts:124-154`
- Test: `worker/src/register.test.ts` (must stay green)

- [ ] **Step 1: Create the helper**

Create `worker/src/registration-email.ts`:

```ts
import type { Env } from './index';
import { sendEmail } from './apps-script';
import type { EditionRow } from './editions';
import { dayLabel } from './editions';
import { editionOrdinal, shortDateRange, capitalize } from './format';
import { buildGoogleCalendarUrl, buildWhatsAppShareUrl } from './calendar';
import type { Day, PassType } from './validation';

export interface ConfirmationInput {
  name: string;
  email: string;
  passType: PassType;
  days: Day[];
  amountPaid: number;
  discount: number;
  tier: string | null;
}

export async function sendRegistrationConfirmation(env: Env, edition: EditionRow, input: ConfirmationInput): Promise<void> {
  const ord = editionOrdinal(edition.slug);
  const editionDisplayName = (ord ? `REPLAY ${ord}` : 'REPLAY').trim();
  await sendEmail(env, {
    template: 'replay-registration',
    to: input.email,
    subject: `${editionDisplayName} — registration confirmed`,
    variables: {
      name: input.name,
      edition_name: editionDisplayName,
      venue: edition.venue,
      date_range: shortDateRange(edition.start_date, edition.end_date),
      pass_type: input.passType,
      days_label: dayLabel(input.days),
      seats: 1,
      amount_paid: input.amountPaid,
      discount_applied: input.discount,
      guild_tier: capitalize(input.tier ?? ''),
      calendar_google_url: buildGoogleCalendarUrl(edition),
      calendar_ics_url: `https://api.replaycon.in/api/ics/${edition.slug}.ics`,
      schedule_url: 'https://replaycon.in/schedule',
      instagram_url: 'https://instagram.com/replaycon',
      whatsapp_share_url: buildWhatsAppShareUrl(edition),
    },
  });
}
```

- [ ] **Step 2: Refactor register.ts to use it**

In `worker/src/register.ts`, replace the inline email block (currently lines ~124-154, the `if (amountPaid === 0) { try { ... } catch ... }`) with:

```ts
  if (amountPaid === 0) {
    try {
      await sendRegistrationConfirmation(env, edition, {
        name, email, passType, days, amountPaid, discount, tier: tierStored,
      });
    } catch (e) {
      console.error('email_failed', e);
    }
  }
```

Add the import near the top of `register.ts`:

```ts
import { sendRegistrationConfirmation } from './registration-email';
```

Remove now-unused imports from `register.ts` if they are no longer referenced (`editionOrdinal`, `shortDateRange`, `capitalize`, `buildGoogleCalendarUrl`, `buildWhatsAppShareUrl`, `dayLabel`) — verify each is unused elsewhere in the file before removing. `dayLabel` may still be unused; `sendEmail` import is no longer needed in register.ts.

- [ ] **Step 3: Run register tests**

Run: `cd worker && npx vitest run src/register.test.ts`
Expected: PASS (behavior unchanged — email still sent on zero-payment path; if the test mocks `./apps-script` `sendEmail`, it still routes through the helper).

If the register test mocked `sendEmail` and now the assertion is on the helper, adjust the test to mock `./registration-email` `sendRegistrationConfirmation` OR keep mocking `./apps-script` (the helper calls `sendEmail`, so the existing mock still intercepts). Prefer the latter — no test change needed.

- [ ] **Step 4: Run full worker suite**

Run: `cd worker && npx vitest run`
Expected: PASS (all existing tests green).

- [ ] **Step 5: Commit**

```bash
git add worker/src/registration-email.ts worker/src/register.ts
git commit -m "Phase 3A: extract sendRegistrationConfirmation for reuse"
```

---

### Task 7: Registrations handlers (list/get/create/patch)

**Files:**
- Create: `worker/src/admin/registrations.ts`
- Test: `worker/src/admin/registrations.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/admin/registrations.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', venue: 'V', start_date: '2026-09-12', end_date: '2026-09-13', capacity_per_day: { day1: 250, day2: 250 } })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', venue: 'V', start_date: '2026-09-12', end_date: '2026-09-13', capacity_per_day: { day1: 250, day2: 250 } })),
}));
vi.mock('../registration-email', () => ({ sendRegistrationConfirmation: vi.fn(async () => {}) }));
import { handleRegPatch, handleRegCreate } from './registrations';

const O = 'https://admin.replaycon.in';

describe('handleRegPatch', () => {
  it('updates payment_status and writes an audit diff', async () => {
    const audit: any = {};
    const sb: any = {
      from: (t: string) => {
        if (t === 'registrations') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'r1', payment_status: 'pending', amount_paid: 800 }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'r1', payment_status: 'confirmed', amount_paid: 800 }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://api.x/api/admin/registrations/r1', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'r1', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.action).toBe('registration.update');
    expect(audit.row.diff.payment_status).toEqual({ old: 'pending', new: 'confirmed' });
  });

  it('returns 404 when registration missing', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const req = new Request('https://api.x/api/admin/registrations/rX', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'rX', 'sid@x.com', O);
    expect(res.status).toBe(404);
  });
});

describe('handleRegCreate', () => {
  it('rejects invalid phone', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://api.x/api/admin/registrations', { method: 'POST', body: JSON.stringify({ phone: '12', pass_type: 'oneshot', days: ['day1'] }) });
    const res = await handleRegCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('creates a registration, upserts user, writes audit', async () => {
    const audit: any = {};
    let insertedReg: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876543210' }, error: null }) }) }),
        };
        if (t === 'registrations') return {
          insert: (row: any) => { insertedReg = row; return { select: () => ({ single: async () => ({ data: { id: 'r9', ...row }, error: null }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://api.x/api/admin/registrations', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', name: 'Asha', pass_type: 'oneshot', days: ['day1'], amount_paid: 800, payment_status: 'confirmed', send_email: false }),
    });
    const res = await handleRegCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(insertedReg.source).toEqual({ manual: true, by: 'sid@x.com' });
    expect(audit.row.action).toBe('registration.create');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/admin/registrations.test.ts`
Expected: FAIL — cannot find module `./registrations`.

- [ ] **Step 3: Implement**

Create `worker/src/admin/registrations.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { sanitizePhone, parseDays, parsePassType } from '../validation';
import { getEditionBySlug, getCurrentEdition } from '../editions';
import { sendRegistrationConfirmation } from '../registration-email';

export async function handleRegList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const slug = params.get('edition');
  const status = params.get('status');
  const q = (params.get('q') || '').trim();

  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  let query = sb
    .from('registrations')
    .select('id, user_phone, pass_type, days, seats, amount_paid, payment_status, created_at, users(name)')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('payment_status', status);
  const { data, error } = await query;
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);

  let rows = (data ?? []) as any[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) => r.user_phone.includes(q) || (r.users?.name || '').toLowerCase().includes(needle),
    );
  }
  return adminJson({ edition: { id: edition.id, slug: edition.slug }, registrations: rows }, 200, origin);
}

export async function handleRegGet(env: Env, sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const { data, error } = await sb
    .from('registrations')
    .select('*, users(name, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ registration: data }, 200, origin);
}

export async function handleRegCreate(req: Request, env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const phone = sanitizePhone(body.phone);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const userEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  const amountPaid = Number.isFinite(Number(body.amount_paid)) ? Number(body.amount_paid) : 0;
  const paymentStatus = body.payment_status === 'pending' ? 'pending' : 'confirmed';
  const sendMail = body.send_email === true;
  const slug = typeof body.edition === 'string' ? body.edition : null;

  if (!phone) return adminJson({ error: 'invalid phone' }, 400, origin);
  if (!passType) return adminJson({ error: 'invalid pass_type' }, 400, origin);
  if (!days) return adminJson({ error: 'invalid days' }, 400, origin);

  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  // User upsert: create if new; only fill empty name/email (never clobber).
  const existing = await sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle();
  if (!existing.data) {
    await sb.from('users').insert({ phone, name: name || null, email: userEmail || null }).select().single();
  } else {
    const patch: any = {};
    if (name && !(existing.data as any).name) patch.name = name;
    if (userEmail && !(existing.data as any).email) patch.email = userEmail;
    if (Object.keys(patch).length) await sb.from('users').update(patch).eq('phone', phone);
  }

  const regRes = await sb
    .from('registrations')
    .insert({
      edition_id: edition.id,
      user_phone: phone,
      pass_type: passType,
      days,
      seats: 1,
      amount_paid: amountPaid,
      discount_applied: 0,
      guild_tier_at_purchase: null,
      payment_status: paymentStatus,
      source: { manual: true, by: email },
    })
    .select()
    .single();
  if (regRes.error || !regRes.data) return adminJson({ error: 'insert_failed' }, 500, origin);
  const reg = regRes.data as { id: string };

  await writeAudit(sb, { actor_email: email, action: 'registration.create', target_table: 'registrations', target_id: reg.id, diff: regRes.data });

  if (sendMail && userEmail) {
    try {
      await sendRegistrationConfirmation(env, edition, { name, email: userEmail, passType, days, amountPaid, discount: 0, tier: null });
    } catch (e) { console.error('email_failed', e); }
  }

  return adminJson({ ok: true, registration_id: reg.id }, 200, origin);
}

export async function handleRegPatch(req: Request, env: Env, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('registrations').select('id, payment_status, amount_paid').eq('id', id).maybeSingle();
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const patch: any = {};
  if (body.payment_status === 'confirmed' || body.payment_status === 'pending' || body.payment_status === 'cancelled') {
    patch.payment_status = body.payment_status;
  }
  if (Number.isFinite(Number(body.amount_paid))) patch.amount_paid = Number(body.amount_paid);
  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('registrations').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(before.data as any, { ...(before.data as any), ...patch });
  await writeAudit(sb, { actor_email: email, action: 'registration.update', target_table: 'registrations', target_id: id, diff });

  return adminJson({ ok: true, registration: upd.data }, 200, origin);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/admin/registrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/registrations.ts worker/src/admin/registrations.test.ts
git commit -m "Phase 3A: registrations admin handlers (list/get/create/patch)"
```

---

### Task 8: Leads handler

**Files:**
- Create: `worker/src/admin/leads.ts`
- Test: `worker/src/admin/leads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/admin/leads.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3' })),
}));
import { handleLeadsList } from './leads';

describe('handleLeadsList', () => {
  it('returns leads for the edition', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'l1' }], error: null }) }) }) }) };
    const req = new Request('https://api.x/api/admin/leads');
    const res = await handleLeadsList(req, {} as any, sb, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.leads).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/admin/leads.test.ts`
Expected: FAIL — cannot find module `./leads`.

- [ ] **Step 3: Implement**

Create `worker/src/admin/leads.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug, getCurrentEdition } from '../editions';

export async function handleLeadsList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('edition');
  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);
  const { data, error } = await sb
    .from('leads')
    .select('*')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false });
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ leads: data ?? [] }, 200, origin);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run src/admin/leads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/leads.ts worker/src/admin/leads.test.ts
git commit -m "Phase 3A: leads admin handler"
```

---

### Task 9: Wire admin routes into index.ts

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/src/index.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `worker/src/index.test.ts` (it already imports the worker default export; mirror its existing style):

```ts
import { describe, it, expect } from 'vitest';
import worker from './index';

const baseEnv = { ENVIRONMENT: 'test', ADMIN_ORIGIN: 'https://admin.replaycon.in', CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'y', ADMIN_EMAILS: 'a@x.com' } as any;

describe('admin gate', () => {
  it('rejects /api/admin/* without a token (401)', async () => {
    const res = await worker.fetch(new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'https://admin.replaycon.in' } }), baseEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('answers admin OPTIONS preflight with credentialed CORS', async () => {
    const res = await worker.fetch(new Request('https://api.x/api/admin/whoami', { method: 'OPTIONS', headers: { Origin: 'https://admin.replaycon.in' } }), baseEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.replaycon.in');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd worker && npx vitest run src/index.test.ts`
Expected: FAIL — admin path returns 404 (not 401) / preflight lacks credentialed headers.

- [ ] **Step 3: Implement**

In `worker/src/index.ts`:

(a) Add fields to the `Env` interface:

```ts
  ADMIN_ORIGIN: string;
```

(b) Add imports at the top:

```ts
import { verifyAccessJwt } from './access-auth';
import { pickAdminOrigin, adminCorsHeaders, adminJson } from './admin/auth';
import { serviceClient } from './supabase';
import { handleWhoami } from './admin/whoami';
import { handleRebuild } from './admin/rebuild';
import { handleDashboard } from './admin/dashboard';
import { handleRegList, handleRegGet, handleRegCreate, handleRegPatch } from './admin/registrations';
import { handleLeadsList } from './admin/leads';
import { handleAuditList } from './admin/audit';
```

(c) Replace the OPTIONS handler to special-case admin preflight:

```ts
    if (req.method === 'OPTIONS') {
      if (path.startsWith('/api/admin/')) {
        return new Response(null, { status: 204, headers: adminCorsHeaders(pickAdminOrigin(req, env)) });
      }
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
```

> Note: `path` must be computed before the OPTIONS check. Move `const url = new URL(req.url); const path = url.pathname;` above the OPTIONS branch.

(d) Add the admin dispatch block inside the `try`, before the public routes:

```ts
      if (path.startsWith('/api/admin/')) {
        const origin = pickAdminOrigin(req, env);
        const token = req.headers.get('Cf-Access-Jwt-Assertion') || '';
        const auth = await verifyAccessJwt(token, env);
        if (!auth.ok) return adminJson({ error: 'unauthorized', reason: auth.reason }, 401, origin);
        const email = auth.email;
        const sb = serviceClient(env);

        if (path === '/api/admin/whoami' && req.method === 'GET') return handleWhoami(email, origin);
        if (path === '/api/admin/rebuild' && req.method === 'POST') return await handleRebuild(env, sb, email, origin);
        if (path === '/api/admin/dashboard' && req.method === 'GET') return await handleDashboard(req, env, sb, origin);
        if (path === '/api/admin/leads' && req.method === 'GET') return await handleLeadsList(req, env, sb, origin);
        if (path === '/api/admin/audit' && req.method === 'GET') return await handleAuditList(req, env, sb, origin);

        if (path === '/api/admin/registrations' && req.method === 'GET') return await handleRegList(req, env, sb, origin);
        if (path === '/api/admin/registrations' && req.method === 'POST') return await handleRegCreate(req, env, sb, email, origin);
        const regMatch = path.match(/^\/api\/admin\/registrations\/([^/]+)$/);
        if (regMatch && req.method === 'GET') return await handleRegGet(env, sb, regMatch[1], origin);
        if (regMatch && req.method === 'PATCH') return await handleRegPatch(req, env, sb, regMatch[1], email, origin);

        return adminJson({ error: 'not_found' }, 404, origin);
      }
```

- [ ] **Step 4: Run, verify pass**

Run: `cd worker && npx vitest run`
Expected: PASS — full suite green (existing 90 + new admin tests).

- [ ] **Step 5: Update wrangler vars**

In `worker/wrangler.toml`, under `[vars]`, add:

```toml
ADMIN_ORIGIN = "https://admin.replaycon.in"
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/wrangler.toml
git commit -m "Phase 3A: wire /api/admin/* gate + dispatch into worker"
```

---

## PART B — Admin SPA scaffold

> All `cp` source paths are from `/Users/siddhantnarula/Projects/bgc-website/admin/`. After each copy, open the file and remove bgc-only imports/resources; the steps list the specific trims.

### Task 10: Tooling + config (tailwind, shadcn, deps)

**Files:**
- Modify: `admin/package.json`, `admin/tsconfig.json`, `admin/vite.config.ts`, `admin/index.html`
- Create: `admin/tailwind.config.js`, `admin/postcss.config.js`, `admin/components.json`, `admin/.env`, `admin/src/index.css`, `admin/src/vite-env.d.ts`

- [ ] **Step 1: Copy config from bgc and install matching deps**

```bash
cp /Users/siddhantnarula/Projects/bgc-website/admin/tailwind.config.js admin/tailwind.config.js
cp /Users/siddhantnarula/Projects/bgc-website/admin/postcss.config.js admin/postcss.config.js
cp /Users/siddhantnarula/Projects/bgc-website/admin/components.json admin/components.json
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/index.css admin/src/index.css
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/vite-env.d.ts admin/src/vite-env.d.ts
```

- [ ] **Step 2: Match dependency versions to bgc admin**

Open `/Users/siddhantnarula/Projects/bgc-website/admin/package.json` and copy its `dependencies` and `devDependencies` version ranges for: `react`, `react-dom`, `react-router-dom`, `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss`, `postcss`, `autoprefixer`, `lucide-react`, `sonner`, `@vitejs/plugin-react`, `vite`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `typescript`. Set the identical versions in `admin/package.json`. Then:

```bash
cd admin && npm install
```

Expected: installs without peer-dep errors. **Do not run `npm install pkg@latest`** — use the exact versions from bgc admin (CLAUDE.md learning: latest pulls incompatible vite).

- [ ] **Step 3: Set the `@/` path alias**

In `admin/tsconfig.json`, ensure `compilerOptions.baseUrl: "."` and `paths: { "@/*": ["./src/*"] }`. In `admin/vite.config.ts`, mirror bgc's resolve alias:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

- [ ] **Step 4: Create `.env`**

Create `admin/.env`:

```
VITE_API_BASE=https://api.replaycon.in
```

> `admin/.env` holds only the public API base (not a secret); fine to commit. The CF Pages project also sets this as a build env var.

- [ ] **Step 5: Verify it builds**

Run: `cd admin && npm run build`
Expected: builds to `admin/dist` (App.tsx is still the placeholder — that's fine).

- [ ] **Step 6: Commit**

```bash
git add admin/package.json admin/package-lock.json admin/tsconfig.json admin/vite.config.ts admin/tailwind.config.js admin/postcss.config.js admin/components.json admin/.env admin/src/index.css admin/src/vite-env.d.ts
git commit -m "Phase 3A: admin tooling (tailwind + shadcn + router deps)"
```

---

### Task 11: shadcn `ui/` primitives + `lib` utilities

**Files:**
- Create: `admin/src/components/ui/*`, `admin/src/lib/utils.ts`, `admin/src/lib/api.ts`, `admin/src/lib/revalidate.ts`, `admin/src/lib/whoami.tsx`, `admin/src/lib/types.ts`

- [ ] **Step 1: Copy the shadcn primitives we use**

```bash
mkdir -p admin/src/components/ui admin/src/lib
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/components/ui/{button,card,badge,table,input,label,textarea,select,switch,checkbox,dialog,drawer,sheet,sonner,skeleton,dropdown-menu}.tsx admin/src/components/ui/
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/lib/utils.ts admin/src/lib/utils.ts
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/lib/api.ts admin/src/lib/api.ts
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/lib/revalidate.ts admin/src/lib/revalidate.ts
```

- [ ] **Step 2: Point `revalidate.ts` at the rebuild endpoint**

Open `admin/src/lib/revalidate.ts`. bgc's `emitRevalidate` triggers a local refresh event after writes — keep that behavior (it re-fetches lists). Verify it has no bgc-specific endpoint URL; if it references a bgc API path, change it to a no-op event emitter (the actual site rebuild is the explicit "Rebuild site" button, not per-write). Final content:

```ts
type Listener = () => void;
const listeners = new Set<Listener>();
export function onRevalidate(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitRevalidate() { listeners.forEach((fn) => fn()); }
```

- [ ] **Step 3: Create `whoami.tsx` (single-role)**

Create `admin/src/lib/whoami.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchAdmin } from './api';

interface WhoAmI { email: string; }
const Ctx = createContext<WhoAmI | null>(null);
export function useWhoAmI() { return useContext(Ctx); }

export function WhoAmIProvider({ fallback, children }: { fallback: ReactNode; children: (who: WhoAmI) => ReactNode }) {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetchAdmin<WhoAmI>('/api/admin/whoami')
      .then(setWho)
      .catch(() => setWho(null))
      .finally(() => setLoaded(true));
  }, []);
  if (!loaded) return <>{fallback}</>;
  if (!who) return <div className="p-8 text-center">Not authorized. <a className="underline" href="/">Reload</a></div>;
  return <Ctx.Provider value={who}>{children(who)}</Ctx.Provider>;
}
```

- [ ] **Step 4: Create replay `types.ts`**

Create `admin/src/lib/types.ts`:

```ts
export type PaymentStatus = 'confirmed' | 'pending' | 'cancelled';
export type PassType = 'oneshot' | 'campaign';
export type Day = 'day1' | 'day2';

export interface RegistrationRow {
  id: string;
  user_phone: string;
  pass_type: PassType;
  days: Day[];
  seats: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  created_at: string;
  users?: { name: string | null } | null;
}

export interface LeadRow {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  created_at: string;
  converted_at: string | null;
}

export interface AuditEntry {
  id: string;
  actor_email: string;
  action: string;
  target_table: string;
  target_id: string | null;
  diff: unknown;
  created_at: string;
}

export interface DashboardData {
  edition: { id: string; slug: string; name: string; registration_status: string };
  spots_by_day: { day1: SpotCount; day2: SpotCount };
  totals: { confirmed: number; pending: number; cancelled: number; revenue: number };
  recent_registrations: RegistrationRow[];
  recent_leads: LeadRow[];
}
export interface SpotCount { capacity: number; confirmed: number; remaining: number; }
```

- [ ] **Step 5: Typecheck**

Run: `cd admin && npx tsc --noEmit`
Expected: no errors (ui/ primitives + lib compile). Fix any bgc-only imports flagged (e.g. delete an unused `ui/` file you didn't copy a dependency for).

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/ui admin/src/lib
git commit -m "Phase 3A: admin shadcn primitives + api/whoami/types libs"
```

---

### Task 12: Layout, navigation, router

**Files:**
- Create: `admin/src/components/{Layout,Sidebar,BottomTabBar,StatusBadge,Loading}.tsx`
- Modify: `admin/src/App.tsx`, `admin/src/main.tsx`

- [ ] **Step 1: Copy + trim navigation components**

```bash
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/components/{Loading,StatusBadge}.tsx admin/src/components/
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/components/{Layout,Sidebar,BottomTabBar}.tsx admin/src/components/
```

Open each of `Layout.tsx`, `Sidebar.tsx`, `BottomTabBar.tsx` and replace bgc's nav item list with replay's four destinations. The nav model (icons from `lucide-react`, active-route highlight) stays; only the items change to:

```tsx
// nav items (use in Sidebar.tsx and BottomTabBar.tsx)
import { LayoutDashboard, Ticket, UserPlus, ScrollText } from 'lucide-react';
export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/registrations', label: 'Registrations', icon: Ticket },
  { to: '/leads', label: 'Leads', icon: UserPlus },
  { to: '/audit', label: 'Audit', icon: ScrollText },
];
```

In `Layout.tsx`, the topbar must show the logged-in email and a "Rebuild site" button. Add to the topbar region:

```tsx
import { useWhoAmI } from '@/lib/whoami';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import { useState } from 'react';
// ...inside the topbar JSX:
function RebuildButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await fetchAdmin('/api/admin/rebuild', { method: 'POST' }); toast.success('Site rebuilding (~60s)…'); }
        catch (e) { showApiError(e); }
        finally { setBusy(false); }
      }}
      className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
    >{busy ? 'Rebuilding…' : 'Rebuild site'}</button>
  );
}
```

Render `<RebuildButton />` and `useWhoAmI()?.email` in the topbar. Remove any bgc-only topbar elements (search for bgc resource names and delete).

- [ ] **Step 2: Write App.tsx (router, single role)**

Replace `admin/src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { WhoAmIProvider } from '@/lib/whoami';
import { Toaster } from '@/components/ui/sonner';
import Dashboard from '@/pages/Dashboard';
import RegistrationsList from '@/pages/RegistrationsList';
import RegistrationDrawer from '@/pages/RegistrationDrawer';
import ManualRegistrationDrawer from '@/pages/ManualRegistrationDrawer';
import Leads from '@/pages/Leads';
import AuditLog from '@/pages/AuditLog';

export function App() {
  return (
    <>
      <WhoAmIProvider fallback={<div className="p-8">Loading…</div>}>
        {() => (
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/registrations" element={<RegistrationsList />} />
                <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
                <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        )}
      </WhoAmIProvider>
      <Toaster />
    </>
  );
}
```

Ensure `admin/src/main.tsx` renders `<App />` and imports `./index.css`.

- [ ] **Step 3: Add placeholder pages so it compiles**

Create minimal stubs for the 6 pages (filled in Tasks 13-17) so the router compiles now:

```tsx
// each of admin/src/pages/{Dashboard,RegistrationsList,RegistrationDrawer,ManualRegistrationDrawer,Leads,AuditLog}.tsx
export default function Page() { return <div className="p-6">…</div>; }
```

- [ ] **Step 4: Build**

Run: `cd admin && npm run build`
Expected: builds; nav renders with 4 items + Rebuild button.

- [ ] **Step 5: Commit**

```bash
git add admin/src/components admin/src/App.tsx admin/src/main.tsx admin/src/pages
git commit -m "Phase 3A: admin layout, nav, router scaffold"
```

---

## PART C — Screens

### Task 13: Dashboard screen

**Files:**
- Modify: `admin/src/pages/Dashboard.tsx`
- Test: `admin/src/pages/Dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/Dashboard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Dashboard from './Dashboard';

it('renders spots and revenue', async () => {
  (fetchAdmin as any).mockResolvedValue({
    edition: { id: 'e1', slug: 'replay-3', name: 'REPLAY', registration_status: 'open' },
    spots_by_day: { day1: { capacity: 250, confirmed: 10, remaining: 240 }, day2: { capacity: 250, confirmed: 8, remaining: 242 } },
    totals: { confirmed: 18, pending: 2, cancelled: 1, revenue: 14400 },
    recent_registrations: [], recent_leads: [],
  });
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByText(/14,?400/)).toBeInTheDocument());
  expect(screen.getByText(/240/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd admin && npx vitest run src/pages/Dashboard.test.tsx`
Expected: FAIL (stub renders `…`).

- [ ] **Step 3: Implement**

Replace `admin/src/pages/Dashboard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { DashboardData } from '@/lib/types';
import Loading from '@/components/Loading';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { fetchAdmin<DashboardData>('/api/admin/dashboard').then(setData).catch(showApiError); }, []);
  if (!data) return <Loading />;
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">{data.edition.name} · {data.edition.registration_status}</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Confirmed" value={data.totals.confirmed} />
        <Stat label="Pending" value={data.totals.pending} />
        <Stat label="Cancelled" value={data.totals.cancelled} />
        <Stat label="Revenue" value={inr(data.totals.revenue)} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SpotBar label="Saturday (day1)" s={data.spots_by_day.day1} />
        <SpotBar label="Sunday (day2)" s={data.spots_by_day.day2} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-bold">{value}</div></div>;
}
function SpotBar({ label, s }: { label: string; s: { capacity: number; confirmed: number; remaining: number } }) {
  const pct = Math.min(100, Math.round((s.confirmed / s.capacity) * 100));
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex justify-between text-sm"><span>{label}</span><span>{s.remaining} left</span></div>
      <div className="h-3 w-full rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: pct + '%' }} /></div>
      <div className="mt-1 text-xs text-muted-foreground">{s.confirmed} / {s.capacity}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd admin && npx vitest run src/pages/Dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/Dashboard.tsx admin/src/pages/Dashboard.test.tsx
git commit -m "Phase 3A: dashboard screen"
```

---

### Task 14: Registrations list (desktop table + mobile cards)

**Files:**
- Create: `admin/src/components/{DataTable,MobileCardList}.tsx` (copy from bgc)
- Modify: `admin/src/pages/RegistrationsList.tsx`
- Test: `admin/src/pages/RegistrationsList.test.tsx`

- [ ] **Step 1: Copy table/card components**

```bash
cp /Users/siddhantnarula/Projects/bgc-website/admin/src/components/{DataTable,MobileCardList}.tsx admin/src/components/
```

Open both and remove bgc-specific column/type imports; they should accept generic `columns` + `rows` props. If a copied component imports a bgc type, change it to a generic `<T>` signature.

- [ ] **Step 2: Write the failing test**

Create `admin/src/pages/RegistrationsList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import RegistrationsList from './RegistrationsList';

it('renders registration rows', async () => {
  (fetchAdmin as any).mockResolvedValue({
    edition: { id: 'e1', slug: 'replay-3' },
    registrations: [{ id: 'r1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'], seats: 1, amount_paid: 800, payment_status: 'confirmed', created_at: '2026-06-01', users: { name: 'Asha' } }],
  });
  render(<MemoryRouter><RegistrationsList /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument());
  expect(screen.getByText('9876543210')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run, verify fail**

Run: `cd admin && npx vitest run src/pages/RegistrationsList.test.tsx`
Expected: FAIL (stub).

- [ ] **Step 4: Implement**

Replace `admin/src/pages/RegistrationsList.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { RegistrationRow, PaymentStatus } from '@/lib/types';
import { onRevalidate } from '@/lib/revalidate';
import Loading from '@/components/Loading';

const STATUSES: (PaymentStatus | 'all')[] = ['all', 'confirmed', 'pending', 'cancelled'];

export default function RegistrationsList() {
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [status, setStatus] = useState<PaymentStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const nav = useNavigate();

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (q) params.set('q', q);
    fetchAdmin<{ registrations: RegistrationRow[] }>(`/api/admin/registrations?${params}`)
      .then((d) => setRows(d.registrations)).catch(showApiError);
  }, [status, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onRevalidate(load), [load]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Registrations</h1>
        <Link to="/registrations/new" className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Add registration</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone" className="rounded-md border px-3 py-1.5 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="rounded-md border px-3 py-1.5 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!rows ? <Loading /> : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Pass</th><th className="p-2">Days</th><th className="p-2">Status</th><th className="p-2">Amount</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => nav(`/registrations/${r.id}`)}>
                  <td className="p-2">{r.users?.name || '—'}</td>
                  <td className="p-2">{r.user_phone}</td>
                  <td className="p-2">{r.pass_type}</td>
                  <td className="p-2">{r.days.join(', ')}</td>
                  <td className="p-2">{r.payment_status}</td>
                  <td className="p-2">₹{Number(r.amount_paid).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

> The plain table keeps the test deterministic. If you prefer the bgc `DataTable`/`MobileCardList` for richer mobile cards, swap the `<table>` for those components with the same columns — but verify the test still finds "Asha" and the phone text.

- [ ] **Step 5: Run, verify pass**

Run: `cd admin && npx vitest run src/pages/RegistrationsList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/DataTable.tsx admin/src/components/MobileCardList.tsx admin/src/pages/RegistrationsList.tsx admin/src/pages/RegistrationsList.test.tsx
git commit -m "Phase 3A: registrations list screen"
```

---

### Task 15: Registration drawer (confirm/cancel)

**Files:**
- Modify: `admin/src/pages/RegistrationDrawer.tsx`
- Test: `admin/src/pages/RegistrationDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/RegistrationDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import RegistrationDrawer from './RegistrationDrawer';

it('confirms a pending registration', async () => {
  (fetchAdmin as any).mockImplementation(async (path: string, init?: any) => {
    if (!init) return { registration: { id: 'r1', user_phone: '9876543210', pass_type: 'oneshot', days: ['day1'], amount_paid: 800, payment_status: 'pending', users: { name: 'Asha', email: 'a@x.com' } } };
    return { ok: true };
  });
  render(<MemoryRouter initialEntries={["/registrations/r1"]}><Routes><Route path="/registrations/:id" element={<RegistrationDrawer />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/registrations/r1', expect.objectContaining({ method: 'PATCH' })));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd admin && npx vitest run src/pages/RegistrationDrawer.test.tsx`
Expected: FAIL (stub).

- [ ] **Step 3: Implement**

Replace `admin/src/pages/RegistrationDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';

interface Detail { id: string; user_phone: string; pass_type: string; days: string[]; amount_paid: number; payment_status: string; users?: { name: string | null; email: string | null } | null; }

export default function RegistrationDrawer() {
  const { id } = useParams();
  const nav = useNavigate();
  const [reg, setReg] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchAdmin<{ registration: Detail }>(`/api/admin/registrations/${id}`).then((d) => setReg(d.registration)).catch(showApiError); }, [id]);

  async function patch(payment_status: string) {
    setBusy(true);
    try { await fetchAdmin(`/api/admin/registrations/${id}`, { method: 'PATCH', body: JSON.stringify({ payment_status }) }); toast.success(`Marked ${payment_status}`); nav('/registrations'); }
    catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/registrations')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      {!reg ? <div>Loading…</div> : (
        <div className="space-y-3">
          <h2 className="text-xl font-bold">{reg.users?.name || '—'}</h2>
          <Field k="Phone" v={reg.user_phone} />
          <Field k="Email" v={reg.users?.email || '—'} />
          <Field k="Pass" v={reg.pass_type} />
          <Field k="Days" v={reg.days.join(', ')} />
          <Field k="Amount" v={'₹' + Number(reg.amount_paid).toLocaleString('en-IN')} />
          <Field k="Status" v={reg.payment_status} />
          <div className="flex gap-2 pt-4">
            {reg.payment_status !== 'confirmed' && <button disabled={busy} onClick={() => patch('confirmed')} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Confirm</button>}
            {reg.payment_status !== 'cancelled' && <button disabled={busy} onClick={() => patch('cancelled')} className="rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50">Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}
function Field({ k, v }: { k: string; v: string }) { return <div className="flex justify-between border-b py-1 text-sm"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>; }
```

- [ ] **Step 4: Run, verify pass**

Run: `cd admin && npx vitest run src/pages/RegistrationDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/RegistrationDrawer.tsx admin/src/pages/RegistrationDrawer.test.tsx
git commit -m "Phase 3A: registration detail drawer with confirm/cancel"
```

---

### Task 16: Manual registration drawer

**Files:**
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx`
- Test: `admin/src/pages/ManualRegistrationDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/ManualRegistrationDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import ManualRegistrationDrawer from './ManualRegistrationDrawer';

it('submits a manual registration', async () => {
  (fetchAdmin as any).mockResolvedValue({ ok: true, registration_id: 'r9' });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/phone/i), '9876543210');
  await userEvent.type(screen.getByLabelText(/name/i), 'Asha');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/registrations', expect.objectContaining({ method: 'POST' })));
});

it('blocks submit when phone is too short', async () => {
  (fetchAdmin as any).mockResolvedValue({ ok: true });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/phone/i), '12');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  expect((fetchAdmin as any)).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd admin && npx vitest run src/pages/ManualRegistrationDrawer.test.tsx`
Expected: FAIL (stub).

- [ ] **Step 3: Implement**

Replace `admin/src/pages/ManualRegistrationDrawer.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';

export default function ManualRegistrationDrawer() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passType, setPassType] = useState<'oneshot' | 'campaign'>('oneshot');
  const [days, setDays] = useState<{ day1: boolean; day2: boolean }>({ day1: true, day2: false });
  const [amount, setAmount] = useState('800');
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const phoneDigits = phone.replace(/\D/g, '');
  const selectedDays = (['day1', 'day2'] as const).filter((d) => days[d]);
  const valid = phoneDigits.length >= 10 && selectedDays.length > 0;

  async function submit() {
    if (!valid) { toast.error('Enter a valid phone and at least one day'); return; }
    setBusy(true);
    try {
      await fetchAdmin('/api/admin/registrations', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneDigits, name, email, pass_type: passType, days: passType === 'campaign' ? ['day1', 'day2'] : selectedDays, amount_paid: Number(amount), payment_status: status, send_email: sendEmail }),
      });
      toast.success('Registration added');
      nav('/registrations');
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/registrations')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      <h2 className="mb-4 text-xl font-bold">Add registration</h2>
      <div className="space-y-3">
        <L label="Phone"><input aria-label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-md border px-3 py-2" /></L>
        <L label="Name"><input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2" /></L>
        <L label="Email"><input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2" /></L>
        <L label="Pass type">
          <select aria-label="Pass type" value={passType} onChange={(e) => setPassType(e.target.value as any)} className="w-full rounded-md border px-3 py-2">
            <option value="oneshot">Oneshot</option><option value="campaign">Campaign (both days)</option>
          </select>
        </L>
        {passType === 'oneshot' && (
          <div className="flex gap-4">
            <label className="flex items-center gap-1"><input type="checkbox" checked={days.day1} onChange={(e) => setDays((d) => ({ ...d, day1: e.target.checked }))} /> Sat</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={days.day2} onChange={(e) => setDays((d) => ({ ...d, day2: e.target.checked }))} /> Sun</label>
          </div>
        )}
        <L label="Amount (₹)"><input aria-label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-md border px-3 py-2" /></L>
        <L label="Status">
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-full rounded-md border px-3 py-2">
            <option value="confirmed">Confirmed</option><option value="pending">Pending</option>
          </select>
        </L>
        <label className="flex items-center gap-2"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Send confirmation email</label>
        <button disabled={busy} onClick={submit} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">{busy ? 'Adding…' : 'Add registration'}</button>
      </div>
    </div>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) { return <div><div className="mb-1 text-sm text-muted-foreground">{label}</div>{children}</div>; }
```

> Capacity is intentionally NOT hard-blocked here (comp/door entries). A soft "day is full" warning can be added later by fetching `/api/admin/dashboard` and comparing — out of scope for 3A's done criteria.

- [ ] **Step 4: Run, verify pass**

Run: `cd admin && npx vitest run src/pages/ManualRegistrationDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx admin/src/pages/ManualRegistrationDrawer.test.tsx
git commit -m "Phase 3A: manual registration drawer"
```

---

### Task 17: Leads + Audit screens

**Files:**
- Modify: `admin/src/pages/Leads.tsx`, `admin/src/pages/AuditLog.tsx`
- Test: `admin/src/pages/Leads.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/Leads.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Leads from './Leads';

it('renders leads', async () => {
  (fetchAdmin as any).mockResolvedValue({ leads: [{ id: 'l1', phone: '9876543210', name: 'Bo', email: 'b@x.com', created_at: '2026-06-01', converted_at: null }] });
  render(<Leads />);
  await waitFor(() => expect(screen.getByText('Bo')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd admin && npx vitest run src/pages/Leads.test.tsx`
Expected: FAIL (stub).

- [ ] **Step 3: Implement both screens**

Replace `admin/src/pages/Leads.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { LeadRow } from '@/lib/types';
import Loading from '@/components/Loading';

export default function Leads() {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  useEffect(() => { fetchAdmin<{ leads: LeadRow[] }>('/api/admin/leads').then((d) => setLeads(d.leads)).catch(showApiError); }, []);
  if (!leads) return <Loading />;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Leads</h1>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left"><tr><th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Email</th><th className="p-2">Created</th><th className="p-2">Converted</th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-t"><td className="p-2">{l.name || '—'}</td><td className="p-2">{l.phone}</td><td className="p-2">{l.email || '—'}</td><td className="p-2">{new Date(l.created_at).toLocaleDateString()}</td><td className="p-2">{l.converted_at ? '✓' : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Replace `admin/src/pages/AuditLog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { AuditEntry } from '@/lib/types';
import Loading from '@/components/Loading';

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { fetchAdmin<{ entries: AuditEntry[] }>('/api/admin/audit').then((d) => setEntries(d.entries)).catch(showApiError); }, []);
  if (!entries) return <Loading />;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className="font-medium">{e.action}</span>
              <span className="text-muted-foreground">{e.target_table}{e.target_id ? ` / ${e.target_id}` : ''}</span>
              <span className="ml-auto text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
            </div>
            <div className="text-xs text-muted-foreground">{e.actor_email}</div>
            {e.diff != null && (
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="mt-1 text-xs underline">{open === e.id ? 'hide' : 'diff'}</button>
            )}
            {open === e.id && <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(e.diff, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run leads test + full admin suite**

Run: `cd admin && npx vitest run`
Expected: PASS (all admin tests).

- [ ] **Step 5: Build**

Run: `cd admin && npm run build`
Expected: clean build to `admin/dist`.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/Leads.tsx admin/src/pages/Leads.test.tsx admin/src/pages/AuditLog.tsx
git commit -m "Phase 3A: leads + audit log screens"
```

---

## PART D — Ops, deploy, verification

### Task 18: Cloudflare Access for the admin API + deploy + manual verification

> These are Cloudflare dashboard / wrangler steps (no unit tests). Do them carefully — they are the spec's flagged risks.

- [ ] **Step 1: Create the CF Access application for the admin API path**

In Cloudflare Zero Trust → Access → Applications, add a **self-hosted** application covering `api.replaycon.in` with path `/api/admin/*` (leave all other `api.replaycon.in` paths public — do NOT protect the whole hostname; `/api/register`, `/api/lead`, `/api/ics/*` must stay open). Allow policy = the same 5 emails as the admin SPA app (`siddhantnarula96@gmail.com`, `amritkochar.007@gmail.com`, `suranjanadatta24@gmail.com`, `swapnilsr21@gmail.com`, `chughyogesh01@gmail.com`).

- [ ] **Step 2: Align AUD**

Note the new application's **AUD tag**. The worker's `CF_ACCESS_AUD` secret must match the AUD of the app that injects the token on `/api/admin/*`. Two valid options:
- (Preferred) Put both the admin SPA host and the `api.replaycon.in/api/admin/*` path into **one** Access application so they share an AUD and SSO cookie — then `CF_ACCESS_AUD` stays a single value.
- Or set `CF_ACCESS_AUD` to the API app's AUD and ensure the SPA app shares the same identity/session.

Verify the live value:
```bash
cd worker && npx wrangler secret list
```
If it needs changing: `cd worker && npx wrangler secret put CF_ACCESS_AUD` (paste the correct AUD).

- [ ] **Step 3: Deploy the worker**

```bash
cd worker && npx wrangler deploy
```
Expected: deploy succeeds; `ADMIN_ORIGIN` var present.

Smoke-test the gate (unauthenticated should 401):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.replaycon.in/api/admin/whoami
```
Expected: `401`.

- [ ] **Step 4: Ensure the admin Pages project builds this app**

Confirm the `replay-admin` Pages project: production branch `main`, root dir `admin`, build cmd `npm run build`, output `admin/dist`, and build env var `VITE_API_BASE=https://api.replaycon.in`. Push `main`; watch the deploy:
```bash
git push origin main
```

- [ ] **Step 5: End-to-end manual verification (the done-criteria checklist)**

Log in at `https://admin.replaycon.in` (CF Access login) and verify in the browser:
1. Dashboard loads; `whoami` shows your email in the topbar (DevTools → Network: `GET /api/admin/whoami` returns 200 with your email, `Access-Control-Allow-Credentials: true`). **If this fails with a CORS/redirect error, the cross-subdomain cookie/SSO is the problem — revisit Step 1-2 (single-app option).**
2. Registrations list loads existing rows (replay-3 has live data).
3. **Add registration** with a test phone (e.g. `0000009999`), Confirmed, email OFF → appears in the list.
4. Open it → **Confirm**, then **Cancel** → status updates each time.
5. Click **Rebuild site** → toast appears; a new deploy shows in the `replay-website` Pages project.
6. Open **Audit** → entries exist for `registration.create`, `registration.update` (with diffs), and `site.rebuild`.
7. Open the admin on a phone → bottom-tab nav works; list is usable; manual-add form is usable.
8. Clean up: cancel/delete the test registration row (via the drawer Cancel, or SQL).

- [ ] **Step 6: Update docs**

Append to `CLAUDE.md` "Session learnings" (one or two lines): Phase 3A admin shipped — `/api/admin/*` gated by `Cf-Access-Jwt-Assertion` via `verifyAccessJwt`, admin SPA at `admin.replaycon.in` (port-and-adapt of bgc admin, single role), audit log writes before/after diffs, "Rebuild site" button is manual-only. Note the CF Access app covering `api.replaycon.in/api/admin/*` and the AUD-alignment decision actually used. Update `docs/superpowers/HANDOFF.md`: mark 3A shipped, fix the stale "scripts/ empty" line, and correct the note that `cancel-registration.ts` uses `verifyAccessJwt` (it does not; the new admin gate in `index.ts` is the reference).

```bash
git add CLAUDE.md docs/superpowers/HANDOFF.md
git commit -m "Phase 3A: log learnings + update handoff"
```

---

## Self-review notes

- **Spec coverage:** scaffold (Tasks 10-12), worker gate + endpoints whoami/rebuild/dashboard/registrations/leads/audit (Tasks 2-9), audit before/after diff (Task 3 + used in 7), Dashboard/Registrations/Leads/Audit screens (Tasks 13-17), manual-add lightweight + optional email + soft capacity (Tasks 7, 16), manual-only Rebuild button (Task 12), full mobile-first nav (Task 12; richer bgc cards optional in Task 14), ops risks 1-3 (Task 18). All spec sections map to a task.
- **Deferred correctly:** no editions CRUD, users, products/orders/sponsors/schedule — those are 3B/3C.
- **Type consistency:** worker handlers share `adminJson(body,status,origin)` signature throughout; `writeAudit`/`diffRows` names stable; admin `fetchAdmin<T>(path, init?)` and `RegistrationRow`/`LeadRow`/`AuditEntry`/`DashboardData` types used consistently across screens.
- **Known mock fragility:** Task 5's dashboard Supabase mock chains two query shapes on one table; the step includes a documented fallback (assert status + remaining, drop revenue assertion) if the chained mock is brittle.
