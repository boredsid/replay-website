# REPLAY Phase 3B — Editions CRUD + Users screen + manual-add edition selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Editions screen (list/create/edit), a Users screen (list/search/edit/view/fix-phone), and an edition selector on manual registration add, to the replay admin SPA + worker.

**Architecture:** New Access-gated `/api/admin/editions*` and `/api/admin/users*` worker handlers (mirroring `worker/src/admin/registrations.ts`), backed by Supabase via the service client. Two SPA screens with list-plus-drawer routing (mirroring `RegistrationsList` + `RegistrationDrawer`). Migration `003` drops the single-current uniqueness rule (current edition is resolved as latest-dated published edition) and adds `ON UPDATE CASCADE` to the phone FKs so phone edits cascade.

**Tech Stack:** Cloudflare Worker (TypeScript, vitest), Supabase JS, React 19 + react-router + Vite + Testing Library (admin SPA), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-06-07-replay-phase-3b-editions-users-design.md`

---

## Conventions (read once)

- Worker admin handlers take `(req, env, sb, [id], [email], origin)` and return `adminJson(body, status, origin)`. See `worker/src/admin/registrations.ts` for the exact shape.
- Every mutating handler calls `writeAudit(sb, { actor_email, action, target_table, target_id, diff })` from `worker/src/admin/audit.ts`. Use `diffRows(before, after)` for update diffs.
- Worker tests mock `sb` as a hand-rolled object with chained methods (see `worker/src/admin/registrations.test.ts`). `const O = 'https://admin.replaycon.in'`.
- Admin tests mock `@/lib/api` (`fetchAdmin`, `showApiError`) and wrap components in `<MemoryRouter>`. See `admin/src/pages/ManualRegistrationDrawer.test.tsx`.
- Run worker tests: `cd worker && npx vitest run <file>`. Run admin tests: `cd admin && npx vitest run <file>`.
- `sanitizePhone`, `parseDays`, `parsePassType` live in `worker/src/validation.ts`.

---

## Task 1: Migration 003 + `getCurrentEdition` resolver

**Files:**
- Create: `supabase/migrations/003_phase3b_admin.sql`
- Modify: `worker/src/editions.ts` (the `getCurrentEdition` function)
- Test: `worker/src/editions.test.ts`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/003_phase3b_admin.sql`:

```sql
-- Phase 3B: relax single-current rule; allow phone edits to cascade.

-- 1. Multiple editions may be is_current; site resolves "current" as the
--    published edition with the latest start_date (see worker getCurrentEdition).
drop index if exists editions_only_one_current;

-- 2. Allow a user's phone (PK) to change and cascade to child rows.
alter table registrations drop constraint registrations_user_phone_fkey;
alter table registrations
  add constraint registrations_user_phone_fkey
  foreign key (user_phone) references users(phone)
  on update cascade on delete restrict;

alter table orders drop constraint orders_user_phone_fkey;
alter table orders
  add constraint orders_user_phone_fkey
  foreign key (user_phone) references users(phone)
  on update cascade on delete restrict;
```

> Note: the constraint names `registrations_user_phone_fkey` / `orders_user_phone_fkey` are Postgres's auto-generated defaults (`<table>_<column>_fkey`). Confirm them at apply time with `mcp__claude_ai_Supabase__list_tables` if the drop errors; the actual apply happens in Task 8.

- [ ] **Step 2: Write the failing resolver test**

Add to `worker/src/editions.test.ts` (create the file if it doesn't exist; if it exists, append the describe block and reuse any existing imports):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const limitMock = vi.fn();
vi.mock('./supabase', () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => ({ limit: limitMock }),
          }),
        }),
      }),
    }),
  }),
}));

import { getCurrentEdition } from './editions';

describe('getCurrentEdition', () => {
  beforeEach(() => limitMock.mockReset());

  it('returns the latest-dated published edition', async () => {
    limitMock.mockResolvedValue({ data: [{ id: 'e3', slug: 'replay-3', start_date: '2026-09-12' }], error: null });
    const ed = await getCurrentEdition({} as any);
    expect(ed?.slug).toBe('replay-3');
  });

  it('returns null when no published edition', async () => {
    limitMock.mockResolvedValue({ data: [], error: null });
    const ed = await getCurrentEdition({} as any);
    expect(ed).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/editions.test.ts`
Expected: FAIL (current `getCurrentEdition` uses `.eq('is_current', true).maybeSingle()`, so the mocked chain `.order().order().limit()` is never reached / returns undefined).

- [ ] **Step 4: Update `getCurrentEdition`**

In `worker/src/editions.ts`, replace the body of `getCurrentEdition`:

```ts
export async function getCurrentEdition(env: Env): Promise<EditionRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('editions')
    .select('*')
    .eq('is_published', true)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`editions: ${error.message}`);
  const rows = (data as EditionRow[]) ?? [];
  return rows[0] ?? null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/editions.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full worker suite to confirm no regressions**

Run: `cd worker && npx vitest run`
Expected: all PASS (the resolver change is covered by mocks elsewhere; if any test asserted `is_current` directly it must be updated — there should be none).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/003_phase3b_admin.sql worker/src/editions.ts worker/src/editions.test.ts
git commit -m "Phase 3B: migration 003 + latest-published getCurrentEdition resolver"
```

---

## Task 2: Worker — editions endpoints

**Files:**
- Create: `worker/src/admin/editions.ts`
- Create: `worker/src/admin/editions.test.ts`
- Modify: `worker/src/index.ts` (dispatch)

- [ ] **Step 1: Write the failing tests**

Create `worker/src/admin/editions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleEdCreate, handleEdPatch } from './editions';

const O = 'https://admin.replaycon.in';
const PRICING = { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 };
const CAP = { day1: 250, day2: 250 };

describe('handleEdCreate', () => {
  it('rejects an invalid slug', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'Bad Slug', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: PRICING, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects end_date before start_date', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'X', start_date: '2027-01-02', end_date: '2027-01-01', pricing: PRICING, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate slug', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e9' }, error: null }) }) }) }) };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-3', name: 'X', start_date: '2027-01-01', end_date: '2027-01-02', pricing: PRICING, capacity_per_day: CAP }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(409);
  });

  it('creates an edition and writes an audit row', async () => {
    const audit: any = {};
    let inserted: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: (row: any) => { inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'e4', ...row }, error: null }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/editions', { method: 'POST', body: JSON.stringify({ slug: 'replay-4', name: 'REPLAY', start_date: '2027-01-01', end_date: '2027-01-02', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP, is_published: false }) });
    const res = await handleEdCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(inserted.slug).toBe('replay-4');
    expect(inserted.registration_status).toBe('upcoming');
    expect(audit.row.action).toBe('edition.create');
  });
});

describe('handleEdPatch', () => {
  it('returns 404 when edition missing', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const req = new Request('https://x/api/admin/editions/eX', { method: 'PATCH', body: JSON.stringify({ registration_status: 'open' }) });
    const res = await handleEdPatch(req, {} as any, sb, 'eX', 'sid@x.com', O);
    expect(res.status).toBe(404);
  });

  it('flips registration_status and writes a diff', async () => {
    const audit: any = {};
    const before = { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', pricing: PRICING, capacity_per_day: CAP, registration_status: 'upcoming', is_current: true, is_published: true };
    const sb: any = {
      from: (t: string) => {
        if (t === 'editions') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { ...before, registration_status: 'open' }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/editions/e3', { method: 'PATCH', body: JSON.stringify({ registration_status: 'open' }) });
    const res = await handleEdPatch(req, {} as any, sb, 'e3', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.diff.registration_status).toEqual({ old: 'upcoming', new: 'open' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run src/admin/editions.test.ts`
Expected: FAIL with "handleEdCreate is not a function" (module doesn't exist yet).

- [ ] **Step 3: Implement the handlers**

Create `worker/src/admin/editions.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { serviceClient } from '../supabase';
import { readPricing } from '../pricing';

const STATUSES = ['upcoming', 'open', 'sold_out', 'closed'];

function readCapacity(input: unknown): { day1: number; day2: number } {
  if (!input || typeof input !== 'object') throw new Error('capacity: not an object');
  const c = input as any;
  if (typeof c.day1 !== 'number' || typeof c.day2 !== 'number') throw new Error('capacity: day1/day2 required as numbers');
  return { day1: c.day1, day2: c.day2 };
}

export async function handleEdList(env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const { data, error } = await sb.from('editions').select('*').order('start_date', { ascending: false });
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return adminJson({ editions: data ?? [] }, 200, origin);
}

export async function handleEdCreate(req: Request, env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!/^[a-z0-9-]+$/.test(slug)) return adminJson({ error: 'invalid_slug' }, 400, origin);
  if (!name) return adminJson({ error: 'invalid_name' }, 400, origin);
  if (typeof body.start_date !== 'string' || typeof body.end_date !== 'string' || body.end_date < body.start_date)
    return adminJson({ error: 'invalid_dates' }, 400, origin);
  const venue = typeof body.venue === 'string' ? body.venue.trim() : '';
  let pricing: unknown, capacity: unknown;
  try { pricing = readPricing(body.pricing); capacity = readCapacity(body.capacity_per_day); }
  catch (e: any) { return adminJson({ error: e.message }, 400, origin); }
  const status = STATUSES.includes(body.registration_status) ? body.registration_status : 'upcoming';

  const taken = await sb.from('editions').select('id').eq('slug', slug).maybeSingle();
  if (taken.data) return adminJson({ error: 'slug_taken' }, 409, origin);

  const ins = await sb.from('editions').insert({
    slug, name, start_date: body.start_date, end_date: body.end_date, venue,
    pricing, capacity_per_day: capacity, registration_status: status,
    is_current: body.is_current === true, is_published: body.is_published === true,
  }).select().single();
  if (ins.error || !ins.data) return adminJson({ error: 'insert_failed' }, 500, origin);

  await writeAudit(sb, { actor_email: email, action: 'edition.create', target_table: 'editions', target_id: (ins.data as any).id, diff: ins.data });
  return adminJson({ ok: true, edition: ins.data }, 200, origin);
}

export async function handleEdPatch(req: Request, env: Env, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('editions').select('*').eq('id', id).maybeSingle();
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);
  const prev = before.data as any;

  const patch: any = {};
  if (typeof body.name === 'string') { if (!body.name.trim()) return adminJson({ error: 'invalid_name' }, 400, origin); patch.name = body.name.trim(); }
  if (typeof body.slug === 'string') {
    const s = body.slug.trim();
    if (!/^[a-z0-9-]+$/.test(s)) return adminJson({ error: 'invalid_slug' }, 400, origin);
    const taken = await sb.from('editions').select('id').eq('slug', s).maybeSingle();
    if (taken.data && (taken.data as any).id !== id) return adminJson({ error: 'slug_taken' }, 409, origin);
    patch.slug = s;
  }
  if (typeof body.start_date === 'string') patch.start_date = body.start_date;
  if (typeof body.end_date === 'string') patch.end_date = body.end_date;
  const sd = patch.start_date ?? prev.start_date;
  const ed = patch.end_date ?? prev.end_date;
  if (ed < sd) return adminJson({ error: 'invalid_dates' }, 400, origin);
  if (typeof body.venue === 'string') patch.venue = body.venue.trim();
  if (body.pricing !== undefined) { try { patch.pricing = readPricing(body.pricing); } catch (e: any) { return adminJson({ error: e.message }, 400, origin); } }
  if (body.capacity_per_day !== undefined) { try { patch.capacity_per_day = readCapacity(body.capacity_per_day); } catch (e: any) { return adminJson({ error: e.message }, 400, origin); } }
  if (STATUSES.includes(body.registration_status)) patch.registration_status = body.registration_status;
  if (typeof body.is_current === 'boolean') patch.is_current = body.is_current;
  if (typeof body.is_published === 'boolean') patch.is_published = body.is_published;

  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('editions').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(prev, { ...prev, ...patch });
  await writeAudit(sb, { actor_email: email, action: 'edition.update', target_table: 'editions', target_id: id, diff });
  return adminJson({ ok: true, edition: upd.data }, 200, origin);
}
```

> Note: `serviceClient` import is kept for parity with other admin modules even though `sb` is passed in; remove it if your linter flags it as unused. (Other handlers receive `sb` from `index.ts`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run src/admin/editions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the routes into `index.ts`**

In `worker/src/index.ts`, add an import after the registrations import (line ~15):

```ts
import { handleEdList, handleEdCreate, handleEdPatch } from './admin/editions';
```

Then add dispatch lines inside the `/api/admin/` block, after the registrations routes and before `return adminJson({ error: 'not_found' }, 404, origin);`:

```ts
        if (path === '/api/admin/editions' && req.method === 'GET') return await handleEdList(env, sb, origin);
        if (path === '/api/admin/editions' && req.method === 'POST') return await handleEdCreate(req, env, sb, email, origin);
        const edMatch = path.match(/^\/api\/admin\/editions\/([^/]+)$/);
        if (edMatch && req.method === 'PATCH') return await handleEdPatch(req, env, sb, edMatch[1], email, origin);
```

- [ ] **Step 6: Run the full worker suite**

Run: `cd worker && npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/admin/editions.ts worker/src/admin/editions.test.ts worker/src/index.ts
git commit -m "Phase 3B: worker editions list/create/patch endpoints"
```

---

## Task 3: Worker — users endpoints

**Files:**
- Create: `worker/src/admin/users.ts`
- Create: `worker/src/admin/users.test.ts`
- Modify: `worker/src/index.ts` (dispatch)

- [ ] **Step 1: Write the failing tests**

Create `worker/src/admin/users.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleUserPatch, handleUserChangePhone } from './users';

const O = 'https://admin.replaycon.in';

describe('handleUserPatch', () => {
  it('updates name/email/notes and writes audit', async () => {
    const audit: any = {};
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { phone: '9876543210', name: 'Old', email: null, notes: null }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876543210', name: 'New' }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/users/9876543210', { method: 'PATCH', body: JSON.stringify({ name: 'New' }) });
    const res = await handleUserPatch(req, {} as any, sb, '9876543210', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.action).toBe('user.update');
  });
});

describe('handleUserChangePhone', () => {
  it('rejects an invalid new phone', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/users/0000000001/change-phone', { method: 'POST', body: JSON.stringify({ phone: '123' }) });
    const res = await handleUserChangePhone(req, {} as any, sb, '0000000001', 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects when the new phone is taken', async () => {
    const sb: any = {
      from: () => ({
        select: () => ({ eq: (col: string, val: string) => ({ maybeSingle: async () => ({ data: val === '9999999999' ? { phone: '9999999999' } : { phone: '0000000001' }, error: null }) }) }),
      }),
    };
    const req = new Request('https://x/api/admin/users/0000000001/change-phone', { method: 'POST', body: JSON.stringify({ phone: '9999999999' }) });
    const res = await handleUserChangePhone(req, {} as any, sb, '0000000001', 'sid@x.com', O);
    expect(res.status).toBe(409);
  });

  it('changes the phone and writes audit', async () => {
    const audit: any = {};
    let updateArg: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: (col: string, val: string) => ({ maybeSingle: async () => ({ data: val === '0000000001' ? { phone: '0000000001' } : null, error: null }) }) }),
          update: (patch: any) => { updateArg = patch; return { eq: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876500000' }, error: null }) }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/users/0000000001/change-phone', { method: 'POST', body: JSON.stringify({ phone: '9876500000' }) });
    const res = await handleUserChangePhone(req, {} as any, sb, '0000000001', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(updateArg).toEqual({ phone: '9876500000' });
    expect(audit.row.action).toBe('user.phone_change');
    expect(audit.row.diff.phone).toEqual({ old: '0000000001', new: '9876500000' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run src/admin/users.test.ts`
Expected: FAIL with "handleUserPatch is not a function".

- [ ] **Step 3: Implement the handlers**

Create `worker/src/admin/users.ts`:

```ts
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { sanitizePhone } from '../validation';

export async function handleUserList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const q = (params.get('q') || '').trim();
  const limit = Math.min(Number(params.get('limit')) || 50, 200);
  const offset = Number(params.get('offset')) || 0;

  let query = sb
    .from('users')
    .select('phone, name, email, notes, created_at, registrations(count)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (q) query = query.or(`phone.ilike.%${q}%,name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);

  const users = (data ?? []).map((u: any) => ({
    phone: u.phone,
    name: u.name,
    email: u.email,
    notes: u.notes,
    created_at: u.created_at,
    registration_count: Array.isArray(u.registrations) && u.registrations[0] ? u.registrations[0].count : 0,
  }));
  return adminJson({ users }, 200, origin);
}

export async function handleUserGet(env: Env, sb: SupabaseClient, phone: string, origin: string): Promise<Response> {
  const { data, error } = await sb
    .from('users')
    .select('*, registrations(*, editions(slug, name)), orders(*)')
    .eq('phone', phone)
    .maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ user: data }, 200, origin);
}

export async function handleUserPatch(req: Request, env: Env, sb: SupabaseClient, phone: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('users').select('phone, name, email, notes').eq('phone', phone).maybeSingle();
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const patch: any = {};
  if (typeof body.name === 'string') patch.name = body.name.trim() || null;
  if (typeof body.email === 'string') patch.email = body.email.trim() || null;
  if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null;
  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('users').update(patch).eq('phone', phone).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(before.data as any, { ...(before.data as any), ...patch });
  await writeAudit(sb, { actor_email: email, action: 'user.update', target_table: 'users', target_id: phone, diff });
  return adminJson({ ok: true, user: upd.data }, 200, origin);
}

export async function handleUserChangePhone(req: Request, env: Env, sb: SupabaseClient, oldPhone: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const newPhone = sanitizePhone(body.phone);
  if (!newPhone || newPhone.length !== 10) return adminJson({ error: 'invalid_phone' }, 400, origin);
  if (newPhone === oldPhone) return adminJson({ error: 'same_phone' }, 400, origin);

  const exists = await sb.from('users').select('phone').eq('phone', oldPhone).maybeSingle();
  if (!exists.data) return adminJson({ error: 'not_found' }, 404, origin);
  const taken = await sb.from('users').select('phone').eq('phone', newPhone).maybeSingle();
  if (taken.data) return adminJson({ error: 'phone_taken' }, 409, origin);

  const upd = await sb.from('users').update({ phone: newPhone }).eq('phone', oldPhone).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  await writeAudit(sb, { actor_email: email, action: 'user.phone_change', target_table: 'users', target_id: newPhone, diff: { phone: { old: oldPhone, new: newPhone } } });
  return adminJson({ ok: true, phone: newPhone }, 200, origin);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run src/admin/users.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the routes into `index.ts`**

Add an import:

```ts
import { handleUserList, handleUserGet, handleUserPatch, handleUserChangePhone } from './admin/users';
```

Add dispatch lines after the editions routes:

```ts
        if (path === '/api/admin/users' && req.method === 'GET') return await handleUserList(req, env, sb, origin);
        const userChangePhone = path.match(/^\/api\/admin\/users\/([^/]+)\/change-phone$/);
        if (userChangePhone && req.method === 'POST') return await handleUserChangePhone(req, env, sb, userChangePhone[1], email, origin);
        const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userMatch && req.method === 'GET') return await handleUserGet(env, sb, userMatch[1], origin);
        if (userMatch && req.method === 'PATCH') return await handleUserPatch(req, env, sb, userMatch[1], email, origin);
```

> Order matters: the `change-phone` regex must be tested before the bare `users/:phone` regex, since `0000000001/change-phone` would otherwise not match the bare pattern anyway (it contains a `/`), but keeping change-phone first is defensive and clear.

- [ ] **Step 6: Run the full worker suite**

Run: `cd worker && npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/admin/users.ts worker/src/admin/users.test.ts worker/src/index.ts
git commit -m "Phase 3B: worker users list/get/patch/change-phone endpoints"
```

---

## Task 4: Admin — types, nav, routes (scaffolding)

**Files:**
- Modify: `admin/src/lib/types.ts`
- Modify: `admin/src/components/nav.ts`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Add types**

Append to `admin/src/lib/types.ts`:

```ts
export interface EditionPricing {
  oneshot: { day1: number; day2: number };
  campaign: number;
  adventurer_cap: number;
}

export interface EditionRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: EditionPricing;
  registration_status: 'upcoming' | 'open' | 'sold_out' | 'closed';
  is_current: boolean;
  is_published: boolean;
}

export interface UserRow {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  registration_count: number;
}

export interface UserDetail {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  registrations: Array<{
    id: string;
    pass_type: string;
    days: string[];
    amount_paid: number;
    payment_status: string;
    created_at: string;
    editions?: { slug: string; name: string } | null;
  }>;
  orders: Array<{ id: string; total: number; payment_status: string; created_at: string }>;
}
```

- [ ] **Step 2: Add nav items**

Replace the contents of `admin/src/components/nav.ts`:

```ts
import { LayoutDashboard, Ticket, UserPlus, ScrollText, Calendar, Users } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/editions', label: 'Editions', icon: Calendar, end: false },
  { to: '/registrations', label: 'Registrations', icon: Ticket, end: false },
  { to: '/users', label: 'Users', icon: Users, end: false },
  { to: '/leads', label: 'Leads', icon: UserPlus, end: false },
  { to: '/audit', label: 'Audit', icon: ScrollText, end: false },
] as const;
```

- [ ] **Step 3: Add routes**

In `admin/src/App.tsx`, add imports near the other page imports:

```tsx
import Editions from '@/pages/Editions';
import EditionDrawer from '@/pages/EditionDrawer';
import Users from '@/pages/Users';
import UserDrawer from '@/pages/UserDrawer';
```

Add routes inside `<Route element={<Layout />}>`, after the registrations routes:

```tsx
              <Route path="/editions" element={<Editions />} />
              <Route path="/editions/new" element={<><Editions /><EditionDrawer /></>} />
              <Route path="/editions/:id" element={<><Editions /><EditionDrawer /></>} />
              <Route path="/users" element={<Users />} />
              <Route path="/users/:phone" element={<><Users /><UserDrawer /></>} />
```

- [ ] **Step 4: Verify it compiles (will fail to build until pages exist — that's expected)**

Run: `cd admin && npx tsc -b --noEmit`
Expected: errors only about the not-yet-created `@/pages/Editions` etc. These resolve in Tasks 5-6. Do NOT commit yet — commit at the end of Task 6 so the tree always builds.

---

## Task 5: Admin — Editions screen + drawer

**Files:**
- Create: `admin/src/pages/Editions.tsx`
- Create: `admin/src/pages/EditionDrawer.tsx`
- Create: `admin/src/pages/Editions.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/Editions.test.tsx`:

```tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Editions from './Editions';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 },
  registration_status: 'upcoming', is_current: true, is_published: true,
};

beforeEach(() => (fetchAdmin as any).mockReset());

it('lists editions', async () => {
  (fetchAdmin as any).mockResolvedValue({ editions: [EDITION] });
  render(<MemoryRouter><Editions /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('replay-3')).toBeInTheDocument());
  expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/editions');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd admin && npx vitest run src/pages/Editions.test.tsx`
Expected: FAIL — cannot find module `./Editions`.

- [ ] **Step 3: Implement `Editions.tsx`**

Create `admin/src/pages/Editions.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { onRevalidate } from '@/lib/revalidate';
import type { EditionRow } from '@/lib/types';

export default function Editions() {
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
      setEditions(res.editions);
    } catch (e) { showApiError(e); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const off = onRevalidate(load); return () => { off(); }; }, []);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Editions</h1>
        <Link to="/editions/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          New edition
        </Link>
      </div>
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-2">
          {editions.map((e) => (
            <Link
              key={e.id}
              to={`/editions/${e.id}`}
              className="flex items-center justify-between rounded-md border p-4 hover:bg-muted"
            >
              <div>
                <div className="font-mono text-sm text-muted-foreground">{e.slug}</div>
                <div className="font-medium">{e.name}</div>
                <div className="text-sm text-muted-foreground">{e.start_date} → {e.end_date} · {e.venue}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full border px-2 py-0.5">{e.registration_status}</span>
                {e.is_current && <span className="rounded-full bg-primary/10 px-2 py-0.5">current</span>}
                {e.is_published ? <span className="rounded-full bg-green-100 px-2 py-0.5">published</span> : <span className="rounded-full bg-muted px-2 py-0.5">draft</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

> `onRevalidate(fn)` is the existing subscribe helper in `admin/src/lib/revalidate.ts` (returns an unsubscribe fn). `fetchAdmin` calls `emitRevalidate()` after every successful mutation, so subscribing re-runs `load` when the drawer saves. This matches `RegistrationsList.tsx:28`.

- [ ] **Step 4: Implement `EditionDrawer.tsx`**

Create `admin/src/pages/EditionDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { EditionRow } from '@/lib/types';

type Form = {
  slug: string; name: string; start_date: string; end_date: string; venue: string;
  registration_status: EditionRow['registration_status'];
  is_current: boolean; is_published: boolean;
  oneshot_day1: string; oneshot_day2: string; campaign: string; adventurer_cap: string;
  cap_day1: string; cap_day2: string;
};

const EMPTY: Form = {
  slug: '', name: 'REPLAY', start_date: '', end_date: '', venue: 'TBD',
  registration_status: 'upcoming', is_current: false, is_published: false,
  oneshot_day1: '800', oneshot_day2: '800', campaign: '1400', adventurer_cap: '1000',
  cap_day1: '250', cap_day2: '250',
};

export default function EditionDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const isNew = !id;
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        const e = res.editions.find((x) => x.id === id);
        if (!e) { toast.error('Edition not found'); nav('/editions'); return; }
        setForm({
          slug: e.slug, name: e.name, start_date: e.start_date, end_date: e.end_date, venue: e.venue,
          registration_status: e.registration_status, is_current: e.is_current, is_published: e.is_published,
          oneshot_day1: String(e.pricing.oneshot.day1), oneshot_day2: String(e.pricing.oneshot.day2),
          campaign: String(e.pricing.campaign), adventurer_cap: String(e.pricing.adventurer_cap),
          cap_day1: String(e.capacity_per_day.day1), cap_day2: String(e.capacity_per_day.day2),
        });
        setLoaded(true);
      } catch (e) { showApiError(e); }
    })();
  }, [id, isNew, nav]);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    setBusy(true);
    const payload = {
      slug: form.slug.trim(), name: form.name, start_date: form.start_date, end_date: form.end_date, venue: form.venue,
      registration_status: form.registration_status, is_current: form.is_current, is_published: form.is_published,
      pricing: {
        oneshot: { day1: Number(form.oneshot_day1), day2: Number(form.oneshot_day2) },
        campaign: Number(form.campaign), adventurer_cap: Number(form.adventurer_cap),
      },
      capacity_per_day: { day1: Number(form.cap_day1), day2: Number(form.cap_day2) },
    };
    try {
      if (isNew) await fetchAdmin('/api/admin/editions', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/editions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Edition created' : 'Edition saved');
      if (confirm('Rebuild the public site now? (edition changes are baked in at build time, ~60s)')) {
        try { await fetchAdmin('/api/admin/rebuild', { method: 'POST' }); toast.success('Site rebuilding…'); }
        catch (e) { showApiError(e, 'Saved, but rebuild failed — use the Rebuild button.'); }
      }
      nav('/editions');
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  if (!loaded) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/editions')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      <h2 className="mb-4 text-xl font-bold">{isNew ? 'New edition' : 'Edit edition'}</h2>
      <div className="space-y-3">
        <F label="Slug"><input aria-label="Slug" value={form.slug} onChange={(e) => set('slug', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Name"><input aria-label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Start date"><input aria-label="Start date" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="End date"><input aria-label="End date" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Venue"><input aria-label="Venue" value={form.venue} onChange={(e) => set('venue', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        <F label="Registration status">
          <select aria-label="Registration status" value={form.registration_status} onChange={(e) => set('registration_status', e.target.value as Form['registration_status'])} className="w-full rounded-md border px-3 py-2">
            <option value="upcoming">upcoming</option>
            <option value="open">open</option>
            <option value="sold_out">sold_out</option>
            <option value="closed">closed</option>
          </select>
        </F>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_current} onChange={(e) => set('is_current', e.target.checked)} /> Current edition</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_published} onChange={(e) => set('is_published', e.target.checked)} /> Published</label>
        <div className="border-t pt-3 text-sm font-semibold">Pricing (₹)</div>
        <div className="grid grid-cols-2 gap-2">
          <F label="Oneshot Sat"><input aria-label="Oneshot Sat" type="number" value={form.oneshot_day1} onChange={(e) => set('oneshot_day1', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Oneshot Sun"><input aria-label="Oneshot Sun" type="number" value={form.oneshot_day2} onChange={(e) => set('oneshot_day2', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Campaign"><input aria-label="Campaign" type="number" value={form.campaign} onChange={(e) => set('campaign', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Adventurer cap"><input aria-label="Adventurer cap" type="number" value={form.adventurer_cap} onChange={(e) => set('adventurer_cap', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        </div>
        <div className="border-t pt-3 text-sm font-semibold">Capacity / day</div>
        <div className="grid grid-cols-2 gap-2">
          <F label="Capacity Sat"><input aria-label="Capacity Sat" type="number" value={form.cap_day1} onChange={(e) => set('cap_day1', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
          <F label="Capacity Sun"><input aria-label="Capacity Sun" type="number" value={form.cap_day2} onChange={(e) => set('cap_day2', e.target.value)} className="w-full rounded-md border px-3 py-2" /></F>
        </div>
        <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Saving…' : isNew ? 'Create edition' : 'Save edition'}
        </button>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><div className="mb-1 text-sm text-muted-foreground">{label}</div>{children}</div>);
}
```

- [ ] **Step 5: Run the Editions test**

Run: `cd admin && npx vitest run src/pages/Editions.test.tsx`
Expected: PASS.

- [ ] **Step 6: Hold commit until Task 6** (so the tree always type-checks — `Users`/`UserDrawer` imports in `App.tsx` are still missing).

---

## Task 6: Admin — Users screen + drawer

**Files:**
- Create: `admin/src/pages/Users.tsx`
- Create: `admin/src/pages/UserDrawer.tsx`
- Create: `admin/src/pages/Users.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/Users.test.tsx`:

```tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Users from './Users';

beforeEach(() => (fetchAdmin as any).mockReset());

it('lists users', async () => {
  (fetchAdmin as any).mockResolvedValue({ users: [{ phone: '9876543210', name: 'Asha', email: null, notes: null, created_at: '2026-01-01', registration_count: 2 }] });
  render(<MemoryRouter><Users /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument());
  expect(screen.getByText('9876543210')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd admin && npx vitest run src/pages/Users.test.tsx`
Expected: FAIL — cannot find module `./Users`.

- [ ] **Step 3: Implement `Users.tsx`**

Create `admin/src/pages/Users.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { UserRow } from '@/lib/types';

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(query: string) {
    setLoading(true);
    try {
      const qs = query ? `?q=${encodeURIComponent(query)}` : '';
      const res = await fetchAdmin<{ users: UserRow[] }>(`/api/admin/users${qs}`);
      setUsers(res.users);
    } catch (e) { showApiError(e); } finally { setLoading(false); }
  }

  useEffect(() => { load(''); }, []);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(v.trim()), 300);
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">Users</h1>
      <input
        aria-label="Search users"
        placeholder="Search by phone or name…"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border px-3 py-2"
      />
      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Link key={u.phone} to={`/users/${u.phone}`} className="flex items-center justify-between rounded-md border p-4 hover:bg-muted">
              <div>
                <div className="font-medium">{u.name || <span className="text-muted-foreground">(no name)</span>}</div>
                <div className="font-mono text-sm text-muted-foreground">{u.phone}{u.email ? ` · ${u.email}` : ''}</div>
              </div>
              <div className="text-sm text-muted-foreground">{u.registration_count} reg{u.registration_count === 1 ? '' : 's'}</div>
            </Link>
          ))}
          {users.length === 0 && <div className="text-muted-foreground">No users found.</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `UserDrawer.tsx`**

Create `admin/src/pages/UserDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { UserDetail } from '@/lib/types';

export default function UserDrawer() {
  const nav = useNavigate();
  const { phone } = useParams();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!phone) return;
    (async () => {
      try {
        const res = await fetchAdmin<{ user: UserDetail }>(`/api/admin/users/${phone}`);
        setUser(res.user);
        setName(res.user.name || '');
        setEmail(res.user.email || '');
        setNotes(res.user.notes || '');
      } catch (e) { showApiError(e); }
    })();
  }, [phone]);

  async function saveDetails() {
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/users/${phone}`, { method: 'PATCH', body: JSON.stringify({ name, email, notes }) });
      toast.success('User saved');
      nav('/users');
    } catch (e) { showApiError(e); } finally { setBusy(false); }
  }

  async function changePhone() {
    const next = prompt('New phone number (10 digits):', '');
    if (!next) return;
    if (!confirm(`Change phone from ${phone} to ${next}? This moves all their registrations and orders.`)) return;
    try {
      await fetchAdmin(`/api/admin/users/${phone}/change-phone`, { method: 'POST', body: JSON.stringify({ phone: next }) });
      toast.success('Phone changed');
      nav('/users');
    } catch (e) { showApiError(e); }
  }

  if (!user) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l bg-background p-6 shadow-xl">
      <button onClick={() => nav('/users')} className="mb-4 text-sm text-muted-foreground">← Close</button>
      <h2 className="mb-1 text-xl font-bold">{user.name || '(no name)'}</h2>
      <div className="mb-4 font-mono text-sm text-muted-foreground">{user.phone}</div>

      <div className="space-y-3">
        <Field label="Name"><input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
        <Field label="Email"><input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
        <Field label="Notes"><textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border px-3 py-2" /></Field>
        <button disabled={busy} onClick={saveDetails} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Saving…' : 'Save details'}
        </button>
        <button onClick={changePhone} className="w-full rounded-md border px-3 py-2 text-sm">Change phone number</button>
      </div>

      <div className="mt-6 border-t pt-4">
        <div className="mb-2 text-sm font-semibold">Registrations ({user.registrations.length})</div>
        <div className="space-y-1 text-sm">
          {user.registrations.map((r) => (
            <div key={r.id} className="flex justify-between">
              <span>{r.editions?.slug || '—'} · {r.pass_type} · {r.days.join('+')}</span>
              <span className="text-muted-foreground">₹{r.amount_paid} · {r.payment_status}</span>
            </div>
          ))}
          {user.registrations.length === 0 && <div className="text-muted-foreground">None.</div>}
        </div>
        {user.orders.length > 0 && (
          <>
            <div className="mt-4 mb-2 text-sm font-semibold">Orders ({user.orders.length})</div>
            <div className="space-y-1 text-sm">
              {user.orders.map((o) => (
                <div key={o.id} className="flex justify-between"><span>{o.id.slice(0, 8)}</span><span className="text-muted-foreground">₹{o.total} · {o.payment_status}</span></div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><div className="mb-1 text-sm text-muted-foreground">{label}</div>{children}</div>);
}
```

- [ ] **Step 5: Run the Users test**

Run: `cd admin && npx vitest run src/pages/Users.test.tsx`
Expected: PASS.

- [ ] **Step 6: Type-check and run the full admin suite**

Run: `cd admin && npx tsc -b --noEmit && npx vitest run`
Expected: type-check clean, all tests PASS.

- [ ] **Step 7: Commit Tasks 4-6 together**

```bash
git add admin/src/lib/types.ts admin/src/components/nav.ts admin/src/App.tsx \
  admin/src/pages/Editions.tsx admin/src/pages/Editions.test.tsx admin/src/pages/EditionDrawer.tsx \
  admin/src/pages/Users.tsx admin/src/pages/Users.test.tsx admin/src/pages/UserDrawer.tsx
git commit -m "Phase 3B: admin editions + users screens, nav, routes, types"
```

---

## Task 7: Admin — manual-add edition selector

**Files:**
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx`
- Modify: `admin/src/pages/ManualRegistrationDrawer.test.tsx`

- [ ] **Step 1: Update the test to expect the edition selector and an `edition` in the payload**

Replace the first test in `admin/src/pages/ManualRegistrationDrawer.test.tsx` (`submits a manual registration`) with a version that loads editions and asserts the slug is sent:

```tsx
it('submits a manual registration with the selected edition', async () => {
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path === '/api/admin/editions') return Promise.resolve({ editions: [
      { id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD', capacity_per_day: { day1: 250, day2: 250 }, pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 }, registration_status: 'upcoming', is_current: true, is_published: true },
    ] });
    return Promise.resolve({ ok: true, registration_id: 'r9' });
  });
  render(<MemoryRouter><ManualRegistrationDrawer /></MemoryRouter>);
  await screen.findByRole('option', { name: /replay-3/i });
  await userEvent.type(screen.getByLabelText(/phone/i), '9876543210');
  await userEvent.type(screen.getByLabelText(/name/i), 'Asha');
  await userEvent.click(screen.getByRole('button', { name: /add registration/i }));
  await waitFor(() => expect((fetchAdmin as any)).toHaveBeenCalledWith('/api/admin/registrations', expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('"edition":"replay-3"'),
  })));
});
```

Keep the existing `blocks submit when phone is too short` test, but it must also mock the editions fetch. Update its `mockResolvedValue` to a `mockImplementation` mirroring the one above (returning the editions list for `/api/admin/editions`, `{ ok: true }` otherwise).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npx vitest run src/pages/ManualRegistrationDrawer.test.tsx`
Expected: FAIL — no `replay-3` option exists; payload lacks `edition`.

- [ ] **Step 3: Add the edition selector to `ManualRegistrationDrawer.tsx`**

At the top of the component, add state + load:

```tsx
import { useEffect, useState } from 'react';
import type { EditionRow } from '@/lib/types';
```

Inside the component, after the existing `useState` calls:

```tsx
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [edition, setEdition] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(res.editions);
        if (res.editions[0]) setEdition(res.editions[0].slug);
      } catch { /* selector stays empty; worker falls back to current edition */ }
    })();
  }, []);

  const selectedEdition = editions.find((e) => e.slug === edition);
  const baseHint = selectedEdition
    ? passType === 'campaign'
      ? selectedEdition.pricing.campaign
      : selectedEdition.pricing.oneshot[selectedDays[0] ?? 'day1']
    : null;
```

> `selectedDays` is already computed in the component; ensure `baseHint` is declared after it. `editions` is ordered `start_date desc`, so `editions[0]` is the latest — a good default.

Add the selector as the first field in the form (before the Phone field):

```tsx
        <L label="Edition">
          <select aria-label="Edition" value={edition} onChange={(e) => setEdition(e.target.value)} className="w-full rounded-md border px-3 py-2">
            {editions.map((e) => (<option key={e.id} value={e.slug}>{e.slug} — {e.name}</option>))}
          </select>
        </L>
```

Add `edition` to the POST body in `submit()`:

```tsx
        body: JSON.stringify({
          edition,
          phone: phoneDigits,
          name,
          email,
          pass_type: passType,
          days: passType === 'campaign' ? ['day1', 'day2'] : selectedDays,
          amount_paid: Number(amount),
          payment_status: status,
          send_email: sendEmail,
        }),
```

Add the non-binding price hint just under the Amount field's `<L label="Amount (₹)">…</L>`:

```tsx
        {baseHint != null && (
          <div className="-mt-2 text-xs text-muted-foreground">Base for this pass: ₹{baseHint}</div>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx vitest run src/pages/ManualRegistrationDrawer.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Run the full admin suite + type-check**

Run: `cd admin && npx tsc -b --noEmit && npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx admin/src/pages/ManualRegistrationDrawer.test.tsx
git commit -m "Phase 3B: edition selector + base-price hint on manual registration add"
```

---

## Task 8: Apply migration, deploy, smoke-test, update HANDOFF

**Files:**
- Modify: `CLAUDE.md` (session learnings), `docs/superpowers/HANDOFF.md` (mark 3B shipped)

- [ ] **Step 1: Verify the FK constraint names before applying**

Use the Supabase MCP to confirm the auto-generated FK constraint names match the migration (`registrations_user_phone_fkey`, `orders_user_phone_fkey`):

Run (MCP): `mcp__claude_ai_Supabase__list_tables` for project `qvkynwlmzeybdiapbcsy`, inspect the `registrations` and `orders` foreign keys. If a name differs, edit `supabase/migrations/003_phase3b_admin.sql` to use the actual constraint name.

- [ ] **Step 2: Apply migration 003**

Run (MCP): `mcp__claude_ai_Supabase__apply_migration` with name `003_phase3b_admin` and the SQL from `supabase/migrations/003_phase3b_admin.sql`.
Expected: success. If "constraint does not exist", fix the name per Step 1 and re-run.

- [ ] **Step 3: Verify the migration**

Run (MCP): `mcp__claude_ai_Supabase__execute_sql` —
```sql
select indexname from pg_indexes where tablename='editions' and indexname='editions_only_one_current';
```
Expected: zero rows (index dropped).
```sql
select confupdtype from pg_constraint where conname in ('registrations_user_phone_fkey','orders_user_phone_fkey');
```
Expected: `confupdtype = 'c'` (cascade) for both.

- [ ] **Step 4: Deploy the worker**

Run: `cd worker && npx wrangler deploy`
Expected: deploy succeeds; note the version id.

- [ ] **Step 5: Smoke-test the live admin endpoints**

In a browser logged into `admin.replaycon.in` (CF Access), open the new screens:
- `/editions` lists replay-1/2/3; open replay-3, flip nothing, confirm it loads.
- `/users` lists users; search a known phone; open a user, confirm registrations render.

(These are gated by CF Access, so they can't be curled without a token — verify via the SPA.)

- [ ] **Step 6: Confirm the CF Pages admin build picks up the new deps**

The admin SPA adds no new npm deps (uses existing `lucide-react`, `sonner`, `react-router-dom`), so no `admin/package.json` change is required. Confirm by checking the imports added in Tasks 4-7 are all already in `admin/package.json` dependencies. If `lucide-react` icons `Calendar`/`Users` are not exported by the pinned version, that surfaces at build — they are standard lucide icons and present.

- [ ] **Step 7: Update HANDOFF + CLAUDE.md**

In `docs/superpowers/HANDOFF.md`:
- Change the `### Phase 3 — full admin tool` "Remaining for 3B/3C" note to mark 3B (editions CRUD, users, manual-add edition selector) shipped, leaving 3C (products/orders/sponsors/schedule) + manual-reg pricing automation.
- Update the status line at the top to mention 3B.

In `CLAUDE.md`, append session learnings:

```
- 2026-06-07 — Phase 3B shipped: admin Editions (list/create/edit) + Users (list/search/edit/view/change-phone) screens + edition selector on manual-add. Migration 003 dropped `editions_only_one_current` — `getCurrentEdition` now resolves to the latest-`start_date` PUBLISHED edition (tiebreak created_at desc), so multiple `is_current=true` rows are allowed and the site shows the newest published event. Migration 003 also recreated `registrations_user_phone_fkey` + `orders_user_phone_fkey` with `on update cascade`, so editing `users.phone` cascades — that's what powers the Users "Change phone number" action (used to fix the 21 replay-2 walk-in placeholder phones). **Why it matters:** don't reintroduce a single-current uniqueness constraint; admins may legitimately flip several editions' is_current. The phone→UUID identity migration (HANDOFF tech-debt item) supersedes the cascade workaround if/when done.
```

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/superpowers/HANDOFF.md
git commit -m "Phase 3B: mark shipped, record learnings"
```

---

## Self-review notes (verification this plan is complete)

- **Spec coverage:** Editions list/create/edit (Tasks 2,5) ✓; Users list/search/edit/view/change-phone (Tasks 3,6) ✓; manual-add edition selector + base hint (Task 7) ✓; migration drop-index + cascade (Task 1,8) ✓; latest-published resolver (Task 1) ✓; rebuild prompt after edition save (Task 5) ✓; audit on every mutation (Tasks 2,3) ✓.
- **Out of scope confirmed absent:** no products/orders/sponsors/schedule, no promo codes, no UUID migration — matches spec.
- **Type consistency:** worker handler names (`handleEdList/Create/Patch`, `handleUserList/Get/Patch/ChangePhone`) used identically in their module, tests, and `index.ts` dispatch. Admin types (`EditionRow`, `UserRow`, `UserDetail`, `EditionPricing`) defined in Task 4, consumed in Tasks 5-7.
- **Known adapt-at-runtime points (flagged inline):** `useRevalidate` export name in `Editions.tsx`; actual FK constraint names before `apply_migration`. Both have explicit fallback instructions.
