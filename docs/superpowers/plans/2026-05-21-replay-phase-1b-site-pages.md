# REPLAY Phase 1B — Site Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 Astro pages (landing, register, schedule) + 2 React islands (RegisterForm, LiveSpotsBadge) for REPLAY 3, wired to Phase 1A's worker. Minimal styling — visual polish lands in Phase 1C.

**Architecture:** Astro SSG pages fetch data from Supabase at build time via anon client + RLS. React islands fetch live data from `api.replaycon.in` worker at runtime. Form is single-page with live discount preview, capacity gating, and UPI payment bottom sheet matching legacy UX.

**Tech Stack:** Astro 6 + React 19 + Tailwind 4 + Vitest + @testing-library/react + jsdom + @supabase/supabase-js (anon).

**Branch:** `rebuild/phase-0` (continues from Phase 1A).

**Working directory:** `/Users/siddhantnarula/Projects/replay-website`. All `npm` commands run from repo root unless noted.

---

## File Structure

```
src/
├── pages/
│   ├── index.astro                       (landing)
│   ├── register.astro                    (register / notify-me, branches on edition status)
│   └── schedule.astro                    (schedule)
├── layouts/
│   └── Layout.astro                      (HTML shell, title/meta/OG, nav, footer placeholder)
├── components/
│   ├── HeroSection.astro                 (consumes landing/hero.mdx + edition info)
│   ├── AboutSection.astro                (consumes landing/about.mdx)
│   ├── SponsorsSection.astro             (renders sponsors[])
│   ├── RegisterCTA.astro                 (CTA + LiveSpotsBadge slot)
│   ├── ScheduleDay.astro                 (renders one day's items[])
│   ├── LiveSpotsBadge.tsx                (island; fetches /api/edition-spots on mount)
│   ├── RegisterForm.tsx                  (island; full registration flow)
│   ├── NotifyMeForm.tsx                  (island; lead capture when reg closed)
│   ├── UpiBottomSheet.tsx                (sub-component; rendered inside RegisterForm)
│   └── SuccessScreen.tsx                 (sub-component; rendered inside RegisterForm)
├── content/
│   ├── config.ts                         (Astro Content Collections schema)
│   └── landing/
│       ├── hero.mdx
│       └── about.mdx
├── lib/
│   ├── supabase.ts                       (anon client; replaces Phase 0 placeholder)
│   ├── worker.ts                         (typed fetch wrappers; lookupPhone, editionSpots, register, cancelRegistration, captureLead)
│   ├── data.ts                           (build-time supabase reads)
│   ├── data.test.ts
│   ├── types.ts                          (EditionRow, SponsorRow, ScheduleItemRow, Api*Response types)
│   └── worker.test.ts
├── styles/global.css                     (Phase 0; unchanged here, expanded in 1C)
└── emails/registration.html              (Phase 1A; unchanged)

vitest.config.ts                          (NEW; jsdom env for component tests)
```

**Boundary rules:**
- `src/lib/supabase.ts` is the only file that creates an anon client. Pages and components never import `createClient` directly.
- `src/lib/worker.ts` is the only file that makes worker fetches. Components import the typed wrappers and never call `fetch()` directly.
- `src/lib/data.ts` is the only file that calls supabase from Astro frontmatter. Astro pages import its helpers.
- React islands are the only components that hydrate client-side; Astro components stay server-rendered.

---

## Task 1: Install React testing deps + Vitest config

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `vitest.config.ts`
- Create: `src/test-setup.ts`

- [ ] **Step 1: Install testing deps**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
npm install --save-dev vitest@latest @testing-library/react@latest @testing-library/jest-dom@latest @testing-library/user-event@latest jsdom@latest @vitejs/plugin-react@latest
```

If a peer-dep conflict surfaces (React 19 + @testing-library), retry with `--legacy-peer-deps`. Note in commit if used.

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Write `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4: Add `test` script to root `package.json`**

Edit `package.json` `scripts` to include:
```json
"test": "vitest run",
"test:watch": "vitest"
```

Keep the existing `dev`, `build`, `preview`, `astro` scripts.

- [ ] **Step 5: Smoke-test the setup**

Run:
```bash
npm test
```

Expected: `No test files found, exiting with code 0` (passes because no tests yet — but proves config loads).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test-setup.ts
git commit -m "Add Vitest + React Testing Library for component tests

Configured jsdom env with @testing-library/jest-dom matchers and
@vitejs/plugin-react for JSX. Lint-time path alias @/* → src/*.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Core types + Supabase anon client

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/supabase.ts`

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
// src/lib/types.ts
export type Day = 'day1' | 'day2';
export type PassType = 'oneshot' | 'campaign';
export type GuildTier = 'initiate' | 'adventurer' | 'guildmaster';
export type RegistrationStatus = 'upcoming' | 'open' | 'sold_out' | 'closed';
export type SponsorTier = 'title' | 'gold' | 'silver' | 'partner';
export type ScheduleKind = 'workshop' | 'tournament' | 'open-play' | 'meal' | 'talk';
export type StepReached = 'phone_entered' | 'name_entered' | 'details_entered';

export interface EditionRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: {
    oneshot: { day1: number; day2: number };
    campaign: number;
    adventurer_cap?: number;
  };
  registration_status: RegistrationStatus;
  is_current: boolean;
  is_published: boolean;
}

export interface SponsorRow {
  id: string;
  edition_id: string;
  name: string;
  tier: SponsorTier;
  logo_url: string;
  website_url: string | null;
  display_order: number;
}

export interface ScheduleItemRow {
  id: string;
  edition_id: string;
  day: string;
  start_time: string;
  end_time: string;
  title: string;
  description: string | null;
  location: string | null;
  kind: ScheduleKind;
}

// Worker response shapes
export interface ApiLookupPhoneResponse {
  user: { found: boolean; name: string | null; email: string | null };
  guild: { tier: GuildTier | null; active: boolean };
  existing_for_edition: { count: number; has_confirmed: boolean };
  discount_blocked: boolean;
}

export interface ApiEditionSpotsResponse {
  day1: { capacity: number; remaining: number; sold_out: boolean };
  day2: { capacity: number; remaining: number; sold_out: boolean };
  both_sold_out: boolean;
}

export interface ApiRegisterRequest {
  phone: string;
  name: string;
  email: string;
  edition_id: string;
  pass_type: PassType;
  days: Day[];
  source?: Record<string, string> | null;
}

export interface ApiRegisterResponse {
  registration_id: string;
  final_amount: number;
  discount_applied: number;
  discount_blocked: boolean;
  payment_required: boolean;
}

export interface ApiErrorResponse {
  error: string;
  field?: string;
  day?: Day;
}
```

- [ ] **Step 2: Write `src/lib/supabase.ts`**

Replace the placeholder file from Phase 0:

```ts
// src/lib/supabase.ts
// Browser-safe anon client. RLS gates every public read. Service-role
// access goes through worker/src/supabase.ts, not here.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const anon = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder';

export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

> Fallback values are intentional so `astro build` doesn't crash when `.env.local` is missing (Phase 0 pattern carried from bgc). React islands resolve real values at runtime via `import.meta.env.PUBLIC_*`.

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run astro check 2>&1 | tail -10
```

Or `npx tsc --noEmit` if astro check is unavailable. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/supabase.ts
git commit -m "Add core types + anon Supabase client

types.ts is the single source for table row + API response shapes
shared between Astro frontmatter, React islands, and tests. supabase.ts
exports the browser-safe anon client; the Phase 0 placeholder is
replaced.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: worker.ts typed fetch wrappers + tests

**Files:**
- Create: `src/lib/worker.ts`
- Create: `src/lib/worker.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/worker.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { lookupPhone, getEditionSpots, registerForEdition, captureLead, cancelRegistration } from './worker';

const WORKER_URL = 'https://api.replaycon.in';

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', WORKER_URL);
  vi.spyOn(global, 'fetch');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  (global.fetch as any).mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('lookupPhone', () => {
  it('POSTs to /api/lookup-phone with phone + edition_id', async () => {
    mockFetch(200, { user: { found: false, name: null, email: null }, guild: { tier: null, active: false }, existing_for_edition: { count: 0, has_confirmed: false }, discount_blocked: false });
    const out = await lookupPhone('9876543210', 'e1');
    expect(out.user.found).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(`${WORKER_URL}/api/lookup-phone`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', edition_id: 'e1' }),
    }));
  });

  it('throws on non-2xx', async () => {
    mockFetch(400, { error: 'invalid phone' });
    await expect(lookupPhone('x', 'e1')).rejects.toThrow();
  });
});

describe('getEditionSpots', () => {
  it('GETs /api/edition-spots/:id', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 250, sold_out: false }, day2: { capacity: 250, remaining: 250, sold_out: false }, both_sold_out: false });
    const out = await getEditionSpots('e1');
    expect(out.day1.remaining).toBe(250);
    expect(global.fetch).toHaveBeenCalledWith(`${WORKER_URL}/api/edition-spots/e1`);
  });
});

describe('registerForEdition', () => {
  it('POSTs to /api/register', async () => {
    mockFetch(200, { registration_id: 'r1', final_amount: 0, discount_applied: 800, discount_blocked: false, payment_required: false });
    const out = await registerForEdition({
      phone: '9876543210', name: 'A', email: 'a@b.c', edition_id: 'e1', pass_type: 'oneshot', days: ['day1'],
    });
    expect(out.registration_id).toBe('r1');
  });
});

describe('captureLead', () => {
  it('POSTs to /api/lead and ignores errors quietly', async () => {
    mockFetch(200, { ok: true });
    await expect(captureLead('9876543210', 'e1', 'phone_entered')).resolves.toEqual({ ok: true });
  });
  it('does NOT throw on non-2xx (fire-and-forget)', async () => {
    mockFetch(500, { error: 'oops' });
    await expect(captureLead('9876543210', 'e1', 'phone_entered')).resolves.toBeUndefined();
  });
});

describe('cancelRegistration', () => {
  it('POSTs to /api/cancel-registration', async () => {
    mockFetch(200, { ok: true, registration_id: 'r1' });
    const out = await cancelRegistration('r1', '9876543210');
    expect(out.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- worker`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/worker.ts`**

```ts
// src/lib/worker.ts
import type {
  ApiLookupPhoneResponse,
  ApiEditionSpotsResponse,
  ApiRegisterRequest,
  ApiRegisterResponse,
  StepReached,
} from './types';

function base(): string {
  const url = import.meta.env.PUBLIC_WORKER_URL;
  if (!url) throw new Error('PUBLIC_WORKER_URL not set');
  return url;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(`worker ${path} returned ${res.status}`);
    (err as any).status = res.status;
    (err as any).body = errBody;
    throw err;
  }
  return (await res.json()) as T;
}

export async function lookupPhone(phone: string, editionId: string): Promise<ApiLookupPhoneResponse> {
  return jsonPost<ApiLookupPhoneResponse>('/api/lookup-phone', { phone, edition_id: editionId });
}

export async function getEditionSpots(editionId: string): Promise<ApiEditionSpotsResponse> {
  const res = await fetch(`${base()}/api/edition-spots/${editionId}`);
  if (!res.ok) {
    const err = new Error(`worker /api/edition-spots returned ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  return (await res.json()) as ApiEditionSpotsResponse;
}

export async function registerForEdition(input: ApiRegisterRequest): Promise<ApiRegisterResponse> {
  return jsonPost<ApiRegisterResponse>('/api/register', input);
}

export async function cancelRegistration(registrationId: string, phone: string): Promise<{ ok: true; registration_id: string }> {
  return jsonPost('/api/cancel-registration', { registration_id: registrationId, phone });
}

/** Fire-and-forget. Resolves to `{ok:true}` on success, `undefined` on any error. */
export async function captureLead(
  phone: string,
  editionId: string,
  stepReached: StepReached,
  name?: string,
): Promise<{ ok: true } | undefined> {
  try {
    const res = await fetch(`${base()}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, edition_id: editionId, step_reached: stepReached, name }),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as { ok: true };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- worker`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/worker.ts src/lib/worker.test.ts
git commit -m "Add typed worker fetch wrappers

5 functions (lookupPhone, getEditionSpots, registerForEdition,
cancelRegistration, captureLead). captureLead is fire-and-forget;
the others throw on non-2xx with response body attached for inline
error rendering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: data.ts build-time Supabase reads + tests

**Files:**
- Create: `src/lib/data.ts`
- Create: `src/lib/data.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/data.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} as any }));

import { supabase } from './supabase';
import { getCurrentEdition, getSponsors, getScheduleItems } from './data';

function mockChain(table: string, result: any) {
  const order = vi.fn().mockReturnThis();
  const limit = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(function (this: any) { return this; });
  const select = vi.fn(function (this: any) { return this; });
  const thenable = { data: result.data, error: result.error };
  const builder: any = { select, eq, order, limit, maybeSingle, single, then: (cb: any) => cb(thenable) };
  return { from: vi.fn().mockReturnValue(builder), builder };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getCurrentEdition', () => {
  it('returns the row when is_current=true and is_published=true', async () => {
    const row = { id: 'e1', slug: 'replay-3', is_current: true, is_published: true };
    const { from } = mockChain('editions', { data: row, error: null });
    Object.assign(supabase, { from });
    const out = await getCurrentEdition();
    expect(out).toEqual(row);
  });

  it('returns null when no row matches', async () => {
    const { from } = mockChain('editions', { data: null, error: null });
    Object.assign(supabase, { from });
    const out = await getCurrentEdition();
    expect(out).toBeNull();
  });
});

describe('getSponsors', () => {
  it('returns ordered sponsors for the edition', async () => {
    const rows = [{ id: 's1', display_order: 0 }, { id: 's2', display_order: 1 }];
    const { from } = mockChain('sponsors', { data: rows, error: null });
    Object.assign(supabase, { from });
    const out = await getSponsors('e1');
    expect(out).toEqual(rows);
  });

  it('returns [] when no sponsors', async () => {
    const { from } = mockChain('sponsors', { data: [], error: null });
    Object.assign(supabase, { from });
    const out = await getSponsors('e1');
    expect(out).toEqual([]);
  });
});

describe('getScheduleItems', () => {
  it('returns ordered items', async () => {
    const rows = [{ id: 'i1', day: '2026-09-12', start_time: '10:00' }, { id: 'i2', day: '2026-09-12', start_time: '11:00' }];
    const { from } = mockChain('schedule_items', { data: rows, error: null });
    Object.assign(supabase, { from });
    const out = await getScheduleItems('e1');
    expect(out).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- data`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/data.ts`**

```ts
// src/lib/data.ts
// Build-time supabase reads from Astro frontmatter. RLS gates every
// query — only is_published rows are visible to the anon client.
import { supabase } from './supabase';
import type { EditionRow, SponsorRow, ScheduleItemRow } from './types';

export async function getCurrentEdition(): Promise<EditionRow | null> {
  const { data, error } = await supabase
    .from('editions')
    .select('*')
    .eq('is_current', true)
    .eq('is_published', true)
    .maybeSingle();
  if (error) {
    console.error('getCurrentEdition error:', error);
    return null;
  }
  return (data as EditionRow) ?? null;
}

export async function getSponsors(editionId: string): Promise<SponsorRow[]> {
  const { data, error } = await supabase
    .from('sponsors')
    .select('*')
    .eq('edition_id', editionId)
    .order('display_order', { ascending: true });
  if (error) {
    console.error('getSponsors error:', error);
    return [];
  }
  return (data as SponsorRow[]) ?? [];
}

export async function getScheduleItems(editionId: string): Promise<ScheduleItemRow[]> {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('*')
    .eq('edition_id', editionId)
    .order('day', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) {
    console.error('getScheduleItems error:', error);
    return [];
  }
  return (data as ScheduleItemRow[]) ?? [];
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- data`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data.ts src/lib/data.test.ts
git commit -m "Add data.ts: build-time supabase reads for Astro pages

getCurrentEdition filters on is_current AND is_published (RLS denies
unpublished); getSponsors and getScheduleItems return ordered arrays.
Errors are logged and the function returns [] / null so build never
fails on missing data.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Content Collections + hero/about MDX

**Files:**
- Create: `src/content/config.ts`
- Create: `src/content/landing/hero.mdx`
- Create: `src/content/landing/about.mdx`

- [ ] **Step 1: Write `src/content/config.ts`**

```ts
import { defineCollection, z } from 'astro:content';

const landing = defineCollection({
  type: 'content',
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  }),
});

export const collections = { landing };
```

- [ ] **Step 2: Write `src/content/landing/hero.mdx`**

```mdx
---
eyebrow: "Bangalore"
title: "A weekend of board games."
subtitle: "Two days. Hundreds of players. One library of 200+ games. Beginners welcome."
---

REPLAY is the convention for people who love sitting down with a stranger and an unfamiliar rulebook. Bring your favourite games or play ones you've never seen. Tournaments, demos, open play, and one big room full of dice.
```

- [ ] **Step 3: Write `src/content/landing/about.mdx`**

```mdx
---
title: "About REPLAY"
---

REPLAY is a board-game convention run by people who play board games. Started in 2025, we run twice or three times a year while we figure out the right cadence for Bangalore's community.

What you'll find:
- A 200+ game library, free to borrow
- Tabletop demos from publishers and designers
- Beginner-friendly tournaments
- Food + chai available all day
- A surprising number of new friends

No prior experience needed. Pick a game, find a table, ask the room — someone's always up for one more round.
```

- [ ] **Step 4: Verify Astro picks up content**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds, no content-collection errors. (The collection isn't used by any page yet, so no rendering happens — this just validates the schema.)

- [ ] **Step 5: Commit**

```bash
git add src/content/
git commit -m "Add Astro Content Collections for landing copy

hero.mdx + about.mdx live under src/content/landing/ with a typed
schema. Editing copy = git commit; this is intentional — content
review goes through PRs, not admin UI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Layout shell

**Files:**
- Create: `src/layouts/Layout.astro`

- [ ] **Step 1: Write `src/layouts/Layout.astro`**

```astro
---
import '../styles/global.css';
export interface Props {
  title: string;
  description?: string;
  ogImage?: string;
}
const { title, description = "Bangalore's board game convention — meet, play, repeat.", ogImage = '/link-preview.png' } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site ?? 'https://replaycon.in').toString();
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:image" content={new URL(ogImage, Astro.site ?? 'https://replaycon.in').toString()} />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" type="image/png" href="/replay-logo.png" />
  </head>
  <body class="bg-[var(--color-replay-bg)] text-[var(--color-replay-ink)] font-sans antialiased">
    <header class="border-b border-[#F0E6D8] px-6 py-4 flex items-center justify-between">
      <a href="/" class="font-bold text-xl">REPLAY</a>
      <nav class="flex gap-6 text-sm">
        <a href="/schedule" class="hover:underline">Schedule</a>
        <a href="/register" class="hover:underline">Register</a>
      </nav>
    </header>
    <main class="min-h-[60vh]">
      <slot />
    </main>
    <footer class="border-t border-[#F0E6D8] px-6 py-8 text-sm text-gray-600">
      <p>&copy; REPLAY · Bangalore · <a href="mailto:hello@replaycon.in" class="hover:underline">hello@replaycon.in</a></p>
    </footer>
  </body>
</html>
```

> Footer with social/links is deferred to 1C. Mailto fallback keeps the page complete.

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: still builds (Layout isn't imported by any page yet).

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Layout.astro
git commit -m "Add Layout shell with SEO meta + OG tags + minimal nav/footer

Per-page title/description/ogImage props. Canonical URL computed from
Astro.site. Reuses Phase 0's link-preview.png as default OG image and
replay-logo.png as favicon. Polish in 1C.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Astro landing components + LiveSpotsBadge island

**Files:**
- Create: `src/components/HeroSection.astro`
- Create: `src/components/AboutSection.astro`
- Create: `src/components/SponsorsSection.astro`
- Create: `src/components/RegisterCTA.astro`
- Create: `src/components/LiveSpotsBadge.tsx`
- Create: `src/components/LiveSpotsBadge.test.tsx`

- [ ] **Step 1: Write `src/components/HeroSection.astro`**

```astro
---
import { getEntry } from 'astro:content';
import type { EditionRow } from '../lib/types';
export interface Props { edition: EditionRow | null }
const { edition } = Astro.props;
const hero = await getEntry('landing', 'hero');
const data = hero?.data ?? {};
const Body = hero ? (await hero.render()).Content : null;
---
<section class="px-6 py-16 max-w-3xl mx-auto">
  {data.eyebrow && <div class="text-sm uppercase tracking-widest text-[var(--color-replay-orange)] mb-2">{data.eyebrow}</div>}
  {data.title && <h1 class="text-4xl md:text-5xl font-bold mb-4">{data.title}</h1>}
  {data.subtitle && <p class="text-lg text-gray-700 mb-4">{data.subtitle}</p>}
  {edition && (
    <p class="text-sm text-gray-600 mt-6">
      <strong>{edition.name}</strong> · {edition.start_date} – {edition.end_date} · {edition.venue}
    </p>
  )}
  {Body && <div class="prose mt-6"><Body /></div>}
</section>
```

- [ ] **Step 2: Write `src/components/AboutSection.astro`**

```astro
---
import { getEntry } from 'astro:content';
const about = await getEntry('landing', 'about');
const Body = about ? (await about.render()).Content : null;
const title = about?.data?.title ?? 'About REPLAY';
---
<section class="px-6 py-12 max-w-3xl mx-auto">
  <h2 class="text-2xl font-bold mb-4">{title}</h2>
  {Body && <div class="prose"><Body /></div>}
</section>
```

- [ ] **Step 3: Write `src/components/SponsorsSection.astro`**

```astro
---
import type { SponsorRow } from '../lib/types';
export interface Props { sponsors: SponsorRow[] }
const { sponsors } = Astro.props;
if (sponsors.length === 0) return null;
const tiers: Array<{ key: string; label: string }> = [
  { key: 'title',   label: 'Title sponsor' },
  { key: 'gold',    label: 'Gold sponsors' },
  { key: 'silver',  label: 'Silver sponsors' },
  { key: 'partner', label: 'Partners' },
];
const byTier = Object.fromEntries(tiers.map((t) => [t.key, sponsors.filter((s) => s.tier === t.key)]));
---
<section class="px-6 py-12 max-w-3xl mx-auto">
  <h2 class="text-2xl font-bold mb-6">Sponsors</h2>
  {tiers.map((t) => byTier[t.key].length > 0 && (
    <div class="mb-6">
      <div class="text-sm uppercase tracking-widest text-gray-600 mb-2">{t.label}</div>
      <div class="flex flex-wrap gap-4">
        {byTier[t.key].map((s) => (
          <a href={s.website_url ?? '#'} target={s.website_url ? '_blank' : undefined} rel="noopener" class="block">
            <img src={s.logo_url} alt={s.name} class="h-12 object-contain" />
          </a>
        ))}
      </div>
    </div>
  ))}
</section>
```

- [ ] **Step 4: Write `src/components/RegisterCTA.astro`**

```astro
---
import type { EditionRow } from '../lib/types';
export interface Props { edition: EditionRow | null }
const { edition } = Astro.props;
const ctaLabel = edition?.registration_status === 'open' ? 'Register now' :
                 edition?.registration_status === 'sold_out' ? 'Sold out' :
                 edition?.registration_status === 'closed' ? 'Registration closed' :
                 'Get notified';
---
<section class="px-6 py-16 text-center max-w-3xl mx-auto">
  {edition ? (
    <>
      <a href="/register" class="inline-block bg-[var(--color-replay-orange)] text-white px-8 py-3 rounded font-bold hover:opacity-90">
        {ctaLabel}
      </a>
      <div class="mt-4">
        <slot />
      </div>
    </>
  ) : (
    <p class="text-gray-600">No upcoming REPLAY right now. Follow on social for announcements.</p>
  )}
</section>
```

- [ ] **Step 5: Write the failing test `src/components/LiveSpotsBadge.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LiveSpotsBadge } from './LiveSpotsBadge';

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.spyOn(global, 'fetch');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  (global.fetch as any).mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('LiveSpotsBadge', () => {
  it('shows loading initially then renders remaining spots', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 248, sold_out: false }, day2: { capacity: 250, remaining: 245, sold_out: false }, both_sold_out: false });
    render(<LiveSpotsBadge editionId="e1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/248/)).toBeInTheDocument());
    expect(screen.getByText(/245/)).toBeInTheDocument();
  });

  it('renders sold-out message when both days are sold out', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 0, sold_out: true }, day2: { capacity: 250, remaining: 0, sold_out: true }, both_sold_out: true });
    render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(screen.getByText(/sold out/i)).toBeInTheDocument());
  });

  it('quietly renders nothing on fetch failure', async () => {
    mockFetch(500, {});
    const { container } = render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(container.textContent).not.toMatch(/loading/i));
    expect(container.textContent?.trim()).toBe('');
  });
});
```

- [ ] **Step 6: Run failing test**

Run: `npm test -- LiveSpotsBadge`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/components/LiveSpotsBadge.tsx`**

```tsx
// src/components/LiveSpotsBadge.tsx
import { useEffect, useState } from 'react';
import { getEditionSpots } from '../lib/worker';
import type { ApiEditionSpotsResponse } from '../lib/types';

export interface LiveSpotsBadgeProps {
  editionId: string;
}

export function LiveSpotsBadge({ editionId }: LiveSpotsBadgeProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEditionSpots(editionId)
      .then((r) => { if (!cancelled) { setSpots(r); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [editionId]);

  if (error) return null;
  if (loading) return <span className="text-sm text-gray-500">Loading…</span>;
  if (!spots) return null;
  if (spots.both_sold_out) return <span className="text-sm font-medium text-red-700">Sold out</span>;
  return (
    <span className="text-sm text-gray-700">
      Day 1: {spots.day1.remaining} left · Day 2: {spots.day2.remaining} left
    </span>
  );
}

export default LiveSpotsBadge;
```

- [ ] **Step 8: Re-run tests**

Run: `npm test -- LiveSpotsBadge`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add src/components/HeroSection.astro src/components/AboutSection.astro src/components/SponsorsSection.astro src/components/RegisterCTA.astro src/components/LiveSpotsBadge.tsx src/components/LiveSpotsBadge.test.tsx
git commit -m "Add landing components + LiveSpotsBadge island

4 Astro components for landing sections (Hero, About, Sponsors,
RegisterCTA) + the LiveSpotsBadge React island that fetches live
edition-spots from the worker. Badge fails silently to nothing on
network errors.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Landing page

**Files:**
- Modify: `src/pages/index.astro` (replace Phase 0 placeholder)

- [ ] **Step 1: Replace `src/pages/index.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import HeroSection from '../components/HeroSection.astro';
import AboutSection from '../components/AboutSection.astro';
import SponsorsSection from '../components/SponsorsSection.astro';
import RegisterCTA from '../components/RegisterCTA.astro';
import LiveSpotsBadge from '../components/LiveSpotsBadge';
import { getCurrentEdition, getSponsors } from '../lib/data';

const edition = await getCurrentEdition();
const sponsors = edition ? await getSponsors(edition.id) : [];
const title = edition ? `${edition.name} — Bangalore's board game convention` : 'REPLAY — Bangalore';
---
<Layout title={title}>
  <HeroSection edition={edition} />
  <AboutSection />
  <SponsorsSection sponsors={sponsors} />
  <RegisterCTA edition={edition}>
    {edition && <LiveSpotsBadge client:load editionId={edition.id} />}
  </RegisterCTA>
</Layout>
```

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds. Look in `dist/index.html` for hero/about copy + the React hydration script for `LiveSpotsBadge`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "Wire landing page

Composes Hero + About + Sponsors + RegisterCTA. Edition + sponsors
fetched at build via anon supabase. LiveSpotsBadge hydrates client-side
inside the CTA when an edition exists.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Schedule page

**Files:**
- Create: `src/components/ScheduleDay.astro`
- Create: `src/pages/schedule.astro`

- [ ] **Step 1: Write `src/components/ScheduleDay.astro`**

```astro
---
import type { ScheduleItemRow } from '../lib/types';
export interface Props {
  date: string;
  label: string;
  items: ScheduleItemRow[];
}
const { date, label, items } = Astro.props;
---
<section class="mb-12">
  <h2 class="text-2xl font-bold mb-1">{label}</h2>
  <p class="text-sm text-gray-600 mb-6">{date}</p>
  {items.length === 0 ? (
    <p class="text-gray-500">No items yet.</p>
  ) : (
    <ul class="divide-y divide-[#F0E6D8]">
      {items.map((i) => (
        <li class="py-3 flex flex-col md:flex-row md:gap-6">
          <div class="text-sm font-mono text-gray-600 md:w-32">
            {i.start_time.slice(0,5)}–{i.end_time.slice(0,5)}
          </div>
          <div class="flex-1">
            <div class="font-semibold">{i.title}</div>
            {i.location && <div class="text-sm text-gray-600">{i.location}</div>}
            {i.description && <p class="text-sm text-gray-700 mt-1">{i.description}</p>}
          </div>
          <div class="text-xs uppercase tracking-widest text-gray-500 md:self-start">{i.kind}</div>
        </li>
      ))}
    </ul>
  )}
</section>
```

- [ ] **Step 2: Write `src/pages/schedule.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import ScheduleDay from '../components/ScheduleDay.astro';
import { getCurrentEdition, getScheduleItems } from '../lib/data';

const edition = await getCurrentEdition();
const items = edition ? await getScheduleItems(edition.id) : [];
const day1Items = edition ? items.filter((i) => i.day === edition.start_date) : [];
const day2Items = edition ? items.filter((i) => i.day === edition.end_date) : [];
const title = edition ? `Schedule — ${edition.name}` : 'Schedule — REPLAY';
---
<Layout title={title} description={edition ? `Schedule for ${edition.name}` : 'REPLAY schedule'}>
  <div class="px-6 py-12 max-w-3xl mx-auto">
    <h1 class="text-3xl font-bold mb-2">Schedule</h1>
    {edition ? (
      <p class="text-gray-600 mb-8">{edition.name} · {edition.start_date} – {edition.end_date} · {edition.venue}</p>
    ) : (
      <p class="text-gray-600 mb-8">No upcoming edition right now.</p>
    )}
    {edition && items.length === 0 ? (
      <p class="text-gray-500">Schedule coming soon.</p>
    ) : edition && (
      <>
        <ScheduleDay date={edition.start_date} label="Saturday" items={day1Items} />
        <ScheduleDay date={edition.end_date} label="Sunday" items={day2Items} />
      </>
    )}
  </div>
</Layout>
```

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -5`
Expected: builds; `dist/schedule/index.html` exists.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScheduleDay.astro src/pages/schedule.astro
git commit -m "Add /schedule page

Renders schedule_items grouped by day with kind labels. Shows
\"Schedule coming soon.\" when items array is empty, matching the
1B graceful-empty UX decision.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: NotifyMeForm React island

**Files:**
- Create: `src/components/NotifyMeForm.tsx`
- Create: `src/components/NotifyMeForm.test.tsx`

- [ ] **Step 1: Write the failing test `src/components/NotifyMeForm.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyMeForm } from './NotifyMeForm';

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.spyOn(global, 'fetch');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('NotifyMeForm', () => {
  it('renders status-specific copy', () => {
    render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="upcoming" />);
    expect(screen.getByText(/opens soon/i)).toBeInTheDocument();
  });

  it('rejects submit with invalid phone', async () => {
    const user = userEvent.setup();
    render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="upcoming" />);
    await user.type(screen.getByLabelText(/phone/i), '12');
    await user.click(screen.getByRole('button', { name: /notify/i }));
    expect(screen.getByText(/enter a 10-digit phone/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /api/lead and shows thanks on submit', async () => {
    const user = userEvent.setup();
    (global.fetch as any).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="upcoming" />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /notify/i }));
    await waitFor(() => expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lead'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"phone":"9876543210"'),
      }),
    );
  });

  it('shows different copy for sold_out and closed', () => {
    const { rerender } = render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="sold_out" />);
    expect(screen.getByText(/sold out/i)).toBeInTheDocument();
    rerender(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="closed" />);
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- NotifyMeForm`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/NotifyMeForm.tsx`**

```tsx
// src/components/NotifyMeForm.tsx
import { useState } from 'react';
import { captureLead } from '../lib/worker';
import type { RegistrationStatus } from '../lib/types';

export interface NotifyMeFormProps {
  editionId: string;
  editionName: string;
  status: Exclude<RegistrationStatus, 'open'>;
}

function sanitize(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function copy(status: NotifyMeFormProps['status'], name: string) {
  if (status === 'sold_out') return { heading: `${name} is sold out`, body: 'Want to hear about the next one? Drop your number.' };
  if (status === 'closed')   return { heading: `${name}: registration closed`, body: 'Drop your number and we\'ll email you about the next REPLAY.' };
  return { heading: `${name}: registration opens soon`, body: 'Drop your number and we\'ll email when it opens.' };
}

export function NotifyMeForm({ editionId, editionName, status }: NotifyMeFormProps) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { heading, body } = copy(status, editionName);

  if (submitted) {
    return (
      <div className="px-6 py-12 max-w-md mx-auto text-center">
        <h2 className="text-2xl font-bold mb-2">Got it.</h2>
        <p className="text-gray-700">We'll be in touch.</p>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sanitized = sanitize(phone);
    if (!sanitized) { setError('Enter a 10-digit phone number'); return; }
    setError(null);
    setSubmitting(true);
    await captureLead(sanitized, editionId, 'phone_entered');
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <div className="px-6 py-12 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-2">{heading}</h1>
      <p className="text-gray-700 mb-6">{body}</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium mb-1">Phone</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2"
            placeholder="9876543210"
            autoComplete="tel"
          />
          {error && <p className="text-sm text-red-700 mt-1">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-[var(--color-replay-orange)] text-white px-6 py-2 rounded font-bold disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Notify me'}
        </button>
      </form>
    </div>
  );
}

export default NotifyMeForm;
```

- [ ] **Step 4: Re-run tests**

Run: `npm test -- NotifyMeForm`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/NotifyMeForm.tsx src/components/NotifyMeForm.test.tsx
git commit -m "Add NotifyMeForm island for closed-registration states

Single-field phone form that posts to /api/lead. Copy varies by
edition status (upcoming / sold_out / closed). Shown on /register
when the edition isn't accepting registrations.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: RegisterForm island (core, with UPI sheet + success screen)

**Files:**
- Create: `src/components/UpiBottomSheet.tsx`
- Create: `src/components/SuccessScreen.tsx`
- Create: `src/components/RegisterForm.tsx`
- Create: `src/components/RegisterForm.test.tsx`

- [ ] **Step 1: Write `src/components/UpiBottomSheet.tsx`**

```tsx
// src/components/UpiBottomSheet.tsx
export interface UpiBottomSheetProps {
  amount: number;
  upiId: string;
  payeeName: string;
  transactionRef: string;
  onPaid: () => void;
  onClose: () => void;
}

export function UpiBottomSheet({ amount, upiId, payeeName, transactionRef, onPaid, onClose }: UpiBottomSheetProps) {
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(upiUrl)}`;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-md p-6">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-bold">Pay ₹{amount}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-500">✕</button>
        </div>
        <div className="text-center mb-4">
          <img src={qrUrl} alt="UPI QR" className="mx-auto" width={240} height={240} />
        </div>
        <p className="text-sm text-gray-700 mb-2"><strong>UPI ID:</strong> {upiId}</p>
        <p className="text-sm text-gray-700 mb-4"><strong>Amount:</strong> ₹{amount}</p>
        <p className="text-xs text-gray-500 mb-4">Pay using any UPI app. Once paid, click below — we'll email you after we confirm the payment manually.</p>
        <button onClick={onPaid} className="w-full bg-[var(--color-replay-orange)] text-white py-3 rounded font-bold">I've paid</button>
      </div>
    </div>
  );
}

export default UpiBottomSheet;
```

- [ ] **Step 2: Write `src/components/SuccessScreen.tsx`**

```tsx
// src/components/SuccessScreen.tsx
export interface SuccessScreenProps {
  pending: boolean;
  editionName: string;
}

export function SuccessScreen({ pending, editionName }: SuccessScreenProps) {
  return (
    <div className="px-6 py-12 max-w-md mx-auto text-center">
      <h2 className="text-3xl font-bold mb-3">{pending ? 'Got it.' : 'You\'re in!'}</h2>
      <p className="text-gray-700 mb-4">
        {pending
          ? `We\'ll email you once we confirm your payment for ${editionName}.`
          : `Confirmation for ${editionName} is on its way to your inbox.`}
      </p>
      <a href="/" className="text-sm underline">Back to home</a>
    </div>
  );
}

export default SuccessScreen;
```

- [ ] **Step 3: Write the failing test `src/components/RegisterForm.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterForm, type RegisterFormProps } from './RegisterForm';
import type { EditionRow } from '../lib/types';

const EDITION: EditionRow = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY 3',
  start_date: '2026-09-12', end_date: '2026-09-13', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: { day1: 800, day2: 800 }, campaign: 1400, adventurer_cap: 1000 },
  registration_status: 'open', is_current: true, is_published: true,
};

function buildProps(overrides: Partial<RegisterFormProps> = {}): RegisterFormProps {
  return { edition: EDITION, upiId: 'test@upi', ...overrides };
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.stubEnv('PUBLIC_UPI_ID', 'test@upi');
  vi.spyOn(global, 'fetch');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockRoute(matcher: (url: string, init?: RequestInit) => boolean, status: number, body: unknown) {
  const old = (global.fetch as any).getMockImplementation?.();
  (global.fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
    if (matcher(url, init)) return new Response(JSON.stringify(body), { status });
    if (old) return old(url, init);
    return new Response('{}', { status: 200 });
  });
}

describe('RegisterForm', () => {
  it('disables sold-out day radios after fetching edition-spots', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 0, sold_out: true },
      day2: { capacity: 250, remaining: 50, sold_out: false },
      both_sold_out: false,
    });
    render(<RegisterForm {...buildProps()} />);
    await waitFor(() => expect(screen.getByLabelText(/saturday/i)).toBeDisabled());
    expect(screen.getByLabelText(/sunday/i)).not.toBeDisabled();
  });

  it('debounces phone lookup and shows guildmaster preview', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: true, name: 'Asha', email: 'a@b.c' },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await waitFor(() => expect(screen.getByText(/welcome back, asha/i)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/guildmaster/i)).toBeInTheDocument();
  });

  it('renders the anti-split warning when discount_blocked', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: true, name: 'Asha', email: 'a@b.c' },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 1, has_confirmed: true },
      discount_blocked: true,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await waitFor(() => expect(screen.getByText(/already registered/i)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('shows UPI sheet on submit when payment_required', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: false, name: null, email: null },
      guild: { tier: null, active: false },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    mockRoute((u) => u.includes('/api/register'), 200, {
      registration_id: 'r1', final_amount: 800, discount_applied: 0, discount_blocked: false, payment_required: true,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'Smoke');
    await user.type(screen.getByLabelText(/email/i), 'smoke@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText(/i've paid/i)).toBeInTheDocument();
  });

  it('shows success screen on amount=0 zero-payment path', async () => {
    mockRoute((u) => u.includes('/api/edition-spots/'), 200, {
      day1: { capacity: 250, remaining: 250, sold_out: false },
      day2: { capacity: 250, remaining: 250, sold_out: false },
      both_sold_out: false,
    });
    mockRoute((u) => u.includes('/api/lookup-phone'), 200, {
      user: { found: false, name: null, email: null },
      guild: { tier: 'guildmaster', active: true },
      existing_for_edition: { count: 0, has_confirmed: false },
      discount_blocked: false,
    });
    mockRoute((u) => u.includes('/api/register'), 200, {
      registration_id: 'r1', final_amount: 0, discount_applied: 800, discount_blocked: false, payment_required: false,
    });
    const user = userEvent.setup();
    render(<RegisterForm {...buildProps()} />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.type(screen.getByLabelText(/name/i), 'GM');
    await user.type(screen.getByLabelText(/email/i), 'gm@test.local');
    await user.click(screen.getByLabelText(/saturday/i));
    await user.click(screen.getByRole('button', { name: /register/i }));
    await waitFor(() => expect(screen.getByText(/you're in!/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 4: Run failing test**

Run: `npm test -- RegisterForm`
Expected: FAIL.

- [ ] **Step 5: Implement `src/components/RegisterForm.tsx`**

```tsx
// src/components/RegisterForm.tsx
import { useEffect, useRef, useState } from 'react';
import { getEditionSpots, lookupPhone, registerForEdition, captureLead } from '../lib/worker';
import type { ApiEditionSpotsResponse, ApiLookupPhoneResponse, EditionRow, Day, PassType } from '../lib/types';
import { UpiBottomSheet } from './UpiBottomSheet';
import { SuccessScreen } from './SuccessScreen';

export interface RegisterFormProps {
  edition: EditionRow;
  upiId: string;
}

function sanitize(p: string): string {
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function tierLabel(t: string | null) {
  if (t === 'guildmaster') return 'Guildmaster (free pass)';
  if (t === 'adventurer') return 'Adventurer (100% off, ₹1,000 max discount)';
  if (t === 'initiate') return 'Initiate (20% off)';
  return null;
}

function computePrice(edition: EditionRow, passType: PassType, days: Day[]): number {
  if (passType === 'campaign') return edition.pricing.campaign;
  return days.length === 1 ? edition.pricing.oneshot[days[0]] : 0;
}

function computeDiscount(base: number, tier: string | null, cap: number): number {
  if (!tier) return 0;
  if (tier === 'initiate') return Math.round(base * 0.2);
  if (tier === 'adventurer') return Math.min(base, cap);
  if (tier === 'guildmaster') return base;
  return 0;
}

export function RegisterForm({ edition, upiId }: RegisterFormProps) {
  const [spots, setSpots] = useState<ApiEditionSpotsResponse | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [passType, setPassType] = useState<PassType>('oneshot');
  const [days, setDays] = useState<Day[]>([]);
  const [lookup, setLookup] = useState<ApiLookupPhoneResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upiOpen, setUpiOpen] = useState<{ amount: number; regId: string } | null>(null);
  const [success, setSuccess] = useState<{ pending: boolean } | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch edition spots on mount
  useEffect(() => {
    let cancelled = false;
    getEditionSpots(edition.id).then((r) => { if (!cancelled) setSpots(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [edition.id]);

  // Debounced phone lookup
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const sanitized = sanitize(phone);
    if (!sanitized) { setLookup(null); return; }
    lookupTimer.current = setTimeout(async () => {
      try {
        const r = await lookupPhone(sanitized, edition.id);
        setLookup(r);
        if (r.user.found) {
          if (r.user.name && !name) setName(r.user.name);
          if (r.user.email && !email) setEmail(r.user.email);
        }
        // lead capture: phone_entered
        captureLead(sanitized, edition.id, 'phone_entered');
      } catch {
        setLookup(null);
      }
    }, 300);
    return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, edition.id]);

  // Lead capture on name/email blur (debounced)
  function scheduleLead(step: 'name_entered' | 'details_entered') {
    const sanitized = sanitize(phone);
    if (!sanitized) return;
    if (leadTimer.current) clearTimeout(leadTimer.current);
    leadTimer.current = setTimeout(() => {
      captureLead(sanitized, edition.id, step, name || undefined);
    }, 1000);
  }

  if (success) return <SuccessScreen pending={success.pending} editionName={edition.name} />;

  const base = computePrice(edition, passType, days);
  const tier = lookup && lookup.guild.active && !lookup.discount_blocked ? lookup.guild.tier : null;
  const cap = edition.pricing.adventurer_cap ?? Infinity;
  const discount = computeDiscount(base, tier, cap);
  const final = base - discount;

  function toggleDay(d: Day) {
    if (passType === 'campaign') {
      setDays(['day1', 'day2']);
      return;
    }
    setDays([d]);
    scheduleLead('details_entered');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sanitized = sanitize(phone);
    if (!sanitized) { setError('Enter a 10-digit phone number'); return; }
    if (!name.trim()) { setError('Name is required'); return; }
    if (!email.trim()) { setError('Email is required'); return; }
    const submitDays: Day[] = passType === 'campaign' ? ['day1', 'day2'] : days;
    if (passType === 'oneshot' && submitDays.length !== 1) { setError('Pick a day'); return; }

    setSubmitting(true);
    try {
      const res = await registerForEdition({
        phone: sanitized, name: name.trim(), email: email.trim(),
        edition_id: edition.id, pass_type: passType, days: submitDays,
      });
      if (res.payment_required) {
        setUpiOpen({ amount: res.final_amount, regId: res.registration_id });
      } else {
        setSuccess({ pending: false });
      }
    } catch (err: any) {
      const body = err?.body ?? {};
      if (body.error === 'sold_out') {
        setError(`Day ${body.day === 'day1' ? 'Saturday' : 'Sunday'} just sold out. Try the other day or campaign pass.`);
        try { setSpots(await getEditionSpots(edition.id)); } catch {}
      } else if (body.error === 'registration_closed') {
        setError('Registration just closed. Please refresh.');
      } else {
        setError(body.error || 'Something went wrong. Please retry.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const day1SoldOut = spots?.day1.sold_out ?? false;
  const day2SoldOut = spots?.day2.sold_out ?? false;
  const bothSoldOut = spots?.both_sold_out ?? false;
  const tierMsg = tierLabel(lookup?.guild.tier ?? null);

  return (
    <div className="px-6 py-12 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-2">Register for {edition.name}</h1>
      <p className="text-gray-700 mb-6">{edition.start_date} – {edition.end_date} · {edition.venue}</p>

      {lookup?.user.found && lookup.user.name && (
        <p className="mb-4 text-sm text-gray-700">Welcome back, {lookup.user.name}.</p>
      )}
      {lookup?.discount_blocked && (
        <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded">
          You've already registered for {edition.name}. Guild Path discount only applies to your first pass.
        </p>
      )}
      {tierMsg && !lookup?.discount_blocked && (
        <p className="mb-4 text-sm text-green-800 bg-green-50 border border-green-200 p-3 rounded">
          {tierMsg}
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium mb-1">Phone</label>
          <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2" placeholder="9876543210" />
        </div>
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">Name</label>
          <input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => scheduleLead('name_entered')}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2" />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onBlur={() => scheduleLead('name_entered')}
            className="w-full border border-[#F0E6D8] rounded px-3 py-2" />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Pass type</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="passType" value="oneshot" checked={passType === 'oneshot'} onChange={() => setPassType('oneshot')} />
            <span>Oneshot (one day · ₹{edition.pricing.oneshot.day1})</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="passType" value="campaign" checked={passType === 'campaign'} onChange={() => { setPassType('campaign'); setDays(['day1','day2']); }} disabled={bothSoldOut} />
            <span>Campaign (both days · ₹{edition.pricing.campaign})</span>
          </label>
        </fieldset>

        {passType === 'oneshot' && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">Day</legend>
            <label className="flex items-center gap-2">
              <input type="radio" id="day1" name="day" checked={days[0] === 'day1'} onChange={() => toggleDay('day1')} disabled={day1SoldOut} aria-label="Saturday" />
              <span>Saturday {day1SoldOut && <span className="text-red-700 text-xs">(sold out)</span>}</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" id="day2" name="day" checked={days[0] === 'day2'} onChange={() => toggleDay('day2')} disabled={day2SoldOut} aria-label="Sunday" />
              <span>Sunday {day2SoldOut && <span className="text-red-700 text-xs">(sold out)</span>}</span>
            </label>
          </fieldset>
        )}

        {base > 0 && (
          <div className="border border-[#F0E6D8] rounded p-3 text-sm">
            <div className="flex justify-between"><span>Base price</span><span>₹{base}</span></div>
            {discount > 0 && (
              <>
                <div className="flex justify-between text-green-800"><span>Discount</span><span>–₹{discount}</span></div>
                <div className="flex justify-between font-bold border-t border-[#F0E6D8] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
              </>
            )}
            {discount === 0 && (
              <div className="flex justify-between font-bold border-t border-[#F0E6D8] pt-2 mt-2"><span>You pay</span><span>₹{final}</span></div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={submitting || bothSoldOut} className="w-full bg-[var(--color-replay-orange)] text-white py-3 rounded font-bold disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Register'}
        </button>
      </form>

      {upiOpen && (
        <UpiBottomSheet
          amount={upiOpen.amount}
          upiId={upiId}
          payeeName="REPLAY Convention"
          transactionRef={upiOpen.regId}
          onPaid={() => { setUpiOpen(null); setSuccess({ pending: true }); }}
          onClose={() => setUpiOpen(null)}
        />
      )}
    </div>
  );
}

export default RegisterForm;
```

- [ ] **Step 6: Re-run tests**

Run: `npm test -- RegisterForm`
Expected: PASS, 5 tests.

> If a test times out around debounce (300ms lookup + 1s lead), increase Vitest's default test timeout in `vitest.config.ts` with `test: { testTimeout: 10000 }`.

- [ ] **Step 7: Commit**

```bash
git add src/components/UpiBottomSheet.tsx src/components/SuccessScreen.tsx src/components/RegisterForm.tsx src/components/RegisterForm.test.tsx
git commit -m "Add RegisterForm island with live discount preview + UPI sheet

Single-page form: debounced phone lookup populates name/email/guild
preview, capacity gating greys out sold-out days, live price preview
shows base/discount/final. Zero-payment path lands on SuccessScreen
directly; non-zero opens UpiBottomSheet with QR + manual confirm.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Register page

**Files:**
- Create: `src/pages/register.astro`

- [ ] **Step 1: Write `src/pages/register.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import RegisterForm from '../components/RegisterForm';
import NotifyMeForm from '../components/NotifyMeForm';
import { getCurrentEdition } from '../lib/data';

const edition = await getCurrentEdition();
const upiId = import.meta.env.PUBLIC_UPI_ID ?? '';

const title = edition ? `Register — ${edition.name}` : 'Register — REPLAY';
---
<Layout title={title}>
  {!edition ? (
    <div class="px-6 py-12 max-w-md mx-auto text-center">
      <h1 class="text-2xl font-bold mb-2">No upcoming REPLAY right now</h1>
      <p class="text-gray-700">Follow us on social for announcements.</p>
    </div>
  ) : edition.registration_status === 'open' ? (
    <RegisterForm client:load edition={edition} upiId={upiId} />
  ) : (
    <NotifyMeForm client:load editionId={edition.id} editionName={edition.name} status={edition.registration_status} />
  )}
</Layout>
```

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all green. Total test counts: data (5) + worker (7) + LiveSpotsBadge (3) + NotifyMeForm (4) + RegisterForm (5) = 24 site tests. Worker tests remain green (run via `cd worker && npm test`, 66 there).

- [ ] **Step 4: Commit**

```bash
git add src/pages/register.astro
git commit -m "Wire /register page (branches between RegisterForm and NotifyMeForm)

Page renders <RegisterForm> when status='open', <NotifyMeForm> for
upcoming/sold_out/closed, and a static \"no current edition\" message
when there's no edition row.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Flip `is_published` for replay-3 + smoke

**Files:** none modified.

- [ ] **Step 1: Flip publish flag in production Supabase**

Use the Supabase MCP `execute_sql` with `project_id=qvkynwlmzeybdiapbcsy` and query:

```sql
update editions set is_published = true where slug = 'replay-3';
select id, slug, is_published, is_current, registration_status from editions where slug='replay-3';
```

Expected: one row, `is_published=true`, `is_current=true`, `registration_status='upcoming'`.

- [ ] **Step 2: Push branch + wait for Cloudflare Pages auto-deploy**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
git push
```

Cloudflare Pages auto-builds on push (configured in Phase 0 Task 19, branch=`rebuild/phase-0`). Allow ~60s for build.

- [ ] **Step 3: Manual smoke on `replay-website.pages.dev`**

Visit https://replay-website.pages.dev/ and verify:
- **Landing:** REPLAY 3 hero copy + about copy + empty sponsors section omitted + CTA button + `LiveSpotsBadge` text shows "Day 1: 250 left · Day 2: 250 left".
- **`/schedule`:** "Schedule coming soon."
- **`/register`:** Notify-me form ("REPLAY 3: registration opens soon" + phone field + "Notify me" button). Fill phone `9000000099`, click Notify me → "Got it. We'll be in touch."

Verify lead landed via Supabase MCP:
```sql
select phone, edition_id, step_reached from leads where phone='9000000099';
```

- [ ] **Step 4: Test the registration flow with a temporary status flip**

```sql
update editions set registration_status = 'open' where slug = 'replay-3';
```

Refresh `/register`. The form should now render. Walk through:
1. Phone: `9000000098` (new). Name: `Smoke Test`. Email: `smoke@test.local`. Pass: Oneshot. Day: Saturday.
2. Live preview should show "Base ₹800 · You pay ₹800".
3. Click Register. UPI bottom sheet opens with QR.
4. Click "I've paid". Success screen shows "Got it." with pending-payment copy.

Verify the registration row:
```sql
select id, user_phone, payment_status, amount_paid, days from registrations where user_phone='9000000098';
```
Expected: payment_status='pending', amount_paid=800.

- [ ] **Step 5: Cleanup**

```sql
delete from registrations where user_phone='9000000098';
delete from users where phone='9000000098';
delete from leads where phone in ('9000000098','9000000099');
update editions set registration_status='upcoming' where slug='replay-3';
```

- [ ] **Step 6: Visit landing + register one more time to confirm reverted state**

- Landing CTA badge: still 250/250.
- `/register`: shows notify-me form again.

---

## Task 14: Append Phase 1B learnings to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (append to Session learnings)

- [ ] **Step 1: Append entries**

Add to the bottom of CLAUDE.md under "Session learnings":

```markdown
- 2026-05-21 — Phase 1B shipped: 3 site pages (/, /register, /schedule), 3 React islands (RegisterForm, NotifyMeForm, LiveSpotsBadge). Anon Supabase reads gated by `is_published` for editions/sponsors/schedule_items. Pages live at replay-website.pages.dev (branch rebuild/phase-0). **Why it matters:** apex DNS still serves the legacy GitHub Pages site; the new site is on a *.pages.dev URL until Phase 1D cutover.
- 2026-05-21 — RegisterForm uses two debounce timers: 300ms on phone field for `/api/lookup-phone`, 1s on name/email blur for `/api/lead`. Capacity gating reads from a `useEffect` that fetches `/api/edition-spots` on mount. **Why it matters:** if a test seems to hang on a `waitFor` for guild preview, the debounce default in Vitest may need bumping (`testTimeout: 10000`).
- 2026-05-21 — Astro Content Collections live at `src/content/landing/{hero,about}.mdx` with a typed schema in `src/content/config.ts`. Edits are PRs, never admin tool. **Why it matters:** copy changes don't trigger the Supabase-save → CF Pages deploy-hook path; they go through normal `git push` to `rebuild/phase-0` (or `main` post-cutover).
```

- [ ] **Step 2: Commit + push**

```bash
git add CLAUDE.md
git commit -m "Document Phase 1B rebuild learnings

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Definition of Done

- [ ] `npm run build` at repo root succeeds; `dist/sitemap-index.xml` includes `/`, `/register`, `/schedule`.
- [ ] `npm test` at root green (24 site tests across 5 files).
- [ ] `cd worker && npm test` still 66/66 green (1A regression).
- [ ] `editions.is_published = true` for replay-3 in production Supabase.
- [ ] Smoke walkthrough on `replay-website.pages.dev` passes: landing renders + LiveSpotsBadge hydrates + `/schedule` graceful empty + `/register` notify-me form captures lead + temporary status flip allows full registration → UPI sheet → success screen.
- [ ] All cleanup SQL run; `registration_status` back to `upcoming`.
- [ ] All commits pushed to `origin/rebuild/phase-0`.
- [ ] CLAUDE.md updated with Phase 1B learnings.
