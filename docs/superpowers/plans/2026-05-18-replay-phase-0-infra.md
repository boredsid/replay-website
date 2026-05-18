# REPLAY Phase 0 — Infra Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up all infrastructure (Supabase project, Cloudflare Worker + 2 Pages projects, DNS, Apps Script, Access policies, bgc cross-call) so Phase 1 can build the public site against it. No user-visible site changes.

**Architecture:** Three deployables (site / admin / worker) mirroring `bgc-website`. New Supabase project for replay. Worker at `api.replaycon.in` calls `bgc-website`'s worker for Guild Path lookups. Email via dedicated replay Apps Script. Admin double-gated by Cloudflare Access + email allowlist.

**Tech Stack:** Astro 5, React 19, Tailwind 4, Vite + shadcn (admin), Cloudflare Worker (TypeScript), Cloudflare Pages, Supabase (Postgres + RLS), Google Apps Script (email), Vitest.

**Production safety:** The current static site at `replaycon.in` must keep serving until Phase 1 cutover. All new infra in this phase lives on **new subdomains** (`api.replaycon.in`, `admin.replaycon.in`) or `*.pages.dev` preview URLs. Do not touch the apex DNS or `.github/workflows/deploy.yml` until Phase 1 says to.

**Cross-repo work:** Task 15 modifies `bgc-website`, not this repo. Open it in a separate clone/worktree and treat it as a small PR there.

---

## File Structure

```
replay-website/
├── docs/superpowers/plans/2026-05-18-replay-phase-0-infra.md   (this file)
├── supabase/
│   ├── config.toml                                              (Supabase CLI link)
│   └── migrations/
│       └── 001_initial_schema.sql                               (all tables + RLS)
├── worker/
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.toml
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                                             (flat if/else router, /api/health stub)
│       ├── supabase.ts                                          (service-role client factory)
│       ├── access-auth.ts                                       (CF Access JWT verify; ported from bgc)
│       ├── access-auth.test.ts                                  (Vitest: valid + invalid JWT)
│       ├── bgc-client.ts                                        (calls bgc /api/guild-status)
│       ├── bgc-client.test.ts                                   (Vitest: mocked fetch)
│       └── apps-script.ts                                       (signed email webhook caller)
├── src/                                                         (Astro shell — placeholder index page only)
│   ├── pages/index.astro
│   └── styles/global.css
├── astro.config.mjs
├── package.json                                                 (root, Astro)
├── tsconfig.json
├── admin/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       └── App.tsx                                              (placeholder "Admin coming soon")
└── apps-script/
    └── Code.gs                                                  (reference snippet — paste into GAS UI)
```

**Boundary rules:**
- `worker/src/*` is the only place that talks to Supabase service-role, bgc worker, or Apps Script.
- `access-auth.ts` is the single auth choke-point for `/api/admin/*`.
- `bgc-client.ts` is the only file that knows bgc's endpoint shape — change there if bgc's contract changes.
- `apps-script.ts` is the only file that signs and POSTs to the GAS webhook.

Old static files (`index.html`, `register.html`, `preorder.html`, etc.) remain untouched in this phase.

---

## Task 1: Archive current site state to a branch

**Files:** none modified; creates branch.

- [ ] **Step 1: Create a safety branch tagging current production state**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
git checkout main
git pull
git branch legacy-static
git push -u origin legacy-static
git checkout main
```

Expected: `legacy-static` branch exists locally + on origin pointing at current `main` HEAD.

- [ ] **Step 2: Confirm GitHub Pages workflow still wired to `main`**

Run: `cat .github/workflows/deploy.yml | grep -E "branches|on:"`
Expected: workflow triggers on `main` push. Do not modify — production stays live off `main`.

---

## Task 2: Add monorepo top-level layout (empty dirs + gitkeeps)

**Files:**
- Create: `worker/.gitkeep`
- Create: `admin/.gitkeep`
- Create: `supabase/migrations/.gitkeep`
- Create: `scripts/.gitkeep`
- Create: `apps-script/.gitkeep`
- Create: `docs/superpowers/plans/.gitkeep` (likely exists already)

- [ ] **Step 1: Create empty directories with placeholder files**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
mkdir -p worker admin supabase/migrations scripts apps-script docs/superpowers/plans
touch worker/.gitkeep admin/.gitkeep supabase/migrations/.gitkeep scripts/.gitkeep apps-script/.gitkeep
```

Expected: dirs exist.

- [ ] **Step 2: Commit**

```bash
git add worker admin supabase scripts apps-script
git commit -m "Scaffold monorepo layout for Phase 0 rebuild"
```

---

## Task 3: Create new Supabase project

**Files:** none yet.

> **User action required.** Subagents cannot create Supabase projects via the dashboard. If executing with the Claude Code Supabase MCP installed, use `mcp__claude_ai_Supabase__create_project` instead.

- [ ] **Step 1: Create project in the Supabase dashboard**

Manual steps:
1. Log in to https://supabase.com/dashboard.
2. Create project: name `replay-website`, region closest to Bangalore (Singapore `ap-southeast-1`), strong DB password (store in 1Password).
3. Wait for provisioning (~2 min).
4. From Project Settings → API, record:
   - Project URL: `https://<ref>.supabase.co`
   - `anon` public key
   - `service_role` secret key
   - Project ref (the `<ref>` chunk)

- [ ] **Step 2: Save credentials locally**

Create a local note (NOT committed) capturing the URL, ref, and both keys. These will be pasted into wrangler secrets and Pages env vars in later tasks.

- [ ] **Step 3: Initialize Supabase CLI link**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
npx -y supabase@latest init
npx -y supabase@latest link --project-ref <ref>
```

Expected: `supabase/config.toml` created; link prompts for DB password.

- [ ] **Step 4: Commit `supabase/config.toml`**

```bash
git add supabase/config.toml
git commit -m "Link Supabase CLI to replay-website project"
```

---

## Task 4: Write migration 001 — schema (no policies yet)

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Write the schema**

```sql
-- supabase/migrations/001_initial_schema.sql
-- REPLAY core schema. See docs/superpowers/specs/2026-05-18-replay-rebuild-design.md.

create extension if not exists "pgcrypto";

-- Editions ------------------------------------------------------------------
create table editions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  start_date date not null,
  end_date date not null,
  venue text not null,
  capacity_per_day jsonb not null,       -- {"day1": 60, "day2": 58}
  pricing jsonb not null,                -- {"oneshot":{"day1":600,"day2":600},"campaign":999}
  registration_status text not null
    check (registration_status in ('upcoming','open','sold_out','closed')),
  is_current boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one current edition at a time.
create unique index editions_only_one_current
  on editions ((true)) where is_current;

-- Users ---------------------------------------------------------------------
create table users (
  phone text primary key,                -- 10-digit normalized
  name text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_phone_format check (phone ~ '^[0-9]{10}$')
);

-- Registrations -------------------------------------------------------------
create table registrations (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete restrict,
  user_phone text not null references users(phone) on delete restrict,
  pass_type text not null check (pass_type in ('oneshot','campaign')),
  days text[] not null,                  -- subset of ['day1','day2']
  seats int not null default 1 check (seats > 0),
  amount_paid numeric(10,2) not null default 0,
  discount_applied numeric(10,2) not null default 0,
  guild_tier_at_purchase text
    check (guild_tier_at_purchase in ('initiate','adventurer','guildmaster') or guild_tier_at_purchase is null),
  payment_status text not null
    check (payment_status in ('confirmed','pending','cancelled')),
  source jsonb,                          -- {"utm_source":"...", ...}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index registrations_edition_status on registrations(edition_id, payment_status);
create index registrations_user_phone on registrations(user_phone);

-- Leads ---------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  phone text not null,
  name text,
  step_reached text not null,
  is_junk boolean not null default false,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint leads_phone_format check (phone ~ '^[0-9]{10}$')
);

create index leads_edition_phone on leads(edition_id, phone);

-- Products (pre-order) ------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  name text not null,
  category text not null check (category in ('puzzle','game')),
  mrp numeric(10,2) not null,
  reselling_price numeric(10,2) not null,
  description text,
  image_urls text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  stock int,
  is_available boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_edition_available on products(edition_id, is_available);

-- Orders --------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete restrict,
  user_phone text not null references users(phone) on delete restrict,
  items jsonb not null,                  -- [{product_id, qty, price, name}]
  total numeric(10,2) not null,
  payment_status text not null
    check (payment_status in ('confirmed','pending','cancelled','fulfilled')),
  source jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_edition_status on orders(edition_id, payment_status);

-- Sponsors ------------------------------------------------------------------
create table sponsors (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  name text not null,
  tier text not null check (tier in ('title','gold','silver','partner')),
  logo_url text not null,
  website_url text,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index sponsors_edition_order on sponsors(edition_id, display_order);

-- Schedule ------------------------------------------------------------------
create table schedule_items (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  day date not null,
  start_time time not null,
  end_time time not null,
  title text not null,
  description text,
  location text,
  kind text not null check (kind in ('workshop','tournament','open-play','meal','talk')),
  created_at timestamptz not null default now()
);

create index schedule_edition_day on schedule_items(edition_id, day, start_time);

-- Audit log (admin writes) --------------------------------------------------
create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,
  target_table text not null,
  target_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

-- updated_at triggers -------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_editions_updated before update on editions
  for each row execute function set_updated_at();
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();
create trigger trg_registrations_updated before update on registrations
  for each row execute function set_updated_at();
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();
```

---

## Task 5: Append RLS policies to migration 001

**Files:**
- Modify: `supabase/migrations/001_initial_schema.sql` (append at end)

- [ ] **Step 1: Append RLS block**

Append to the same file:

```sql
-- RLS -----------------------------------------------------------------------
alter table editions          enable row level security;
alter table users             enable row level security;
alter table registrations     enable row level security;
alter table leads             enable row level security;
alter table products          enable row level security;
alter table orders            enable row level security;
alter table sponsors          enable row level security;
alter table schedule_items    enable row level security;
alter table admin_audit_log   enable row level security;

-- Public read: published editions + their public-safe children.
create policy editions_public_read on editions
  for select using (is_published = true);

create policy sponsors_public_read on sponsors
  for select using (
    exists (select 1 from editions e where e.id = sponsors.edition_id and e.is_published)
  );

create policy schedule_public_read on schedule_items
  for select using (
    exists (select 1 from editions e where e.id = schedule_items.edition_id and e.is_published)
  );

create policy products_public_read on products
  for select using (
    is_available = true and exists (
      select 1 from editions e where e.id = products.edition_id and e.is_published
    )
  );

-- All other tables: no anon access. Service-role (worker) bypasses RLS.
-- (No SELECT/INSERT/UPDATE/DELETE policies = anon denied for users, registrations,
--  leads, orders, admin_audit_log.)
```

---

## Task 6: Apply migration 001 to the new Supabase project

**Files:** none modified.

- [ ] **Step 1: Push migration**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
npx -y supabase@latest db push
```

Expected: migration applied; CLI prints `Applying migration 001_initial_schema.sql`. If using the Supabase MCP instead, call `mcp__claude_ai_Supabase__apply_migration` with the file's contents.

- [ ] **Step 2: Verify tables exist**

Run:
```bash
npx -y supabase@latest db remote list
```
Or open the Supabase Studio → Table Editor and confirm all 9 tables present.

- [ ] **Step 3: Verify RLS rejects anon access to private tables**

Open Supabase Studio → SQL Editor and run as anon role:
```sql
set role anon;
select count(*) from users;          -- expect: error / permission denied or 0 with rls
select count(*) from registrations;  -- expect: 0 rows (rls denies)
select count(*) from editions;       -- expect: 0 rows (none published yet)
reset role;
```

Expected: no rows returned for private tables (and editions returns 0 because none published yet).

- [ ] **Step 4: Commit migration**

```bash
git add supabase/migrations/001_initial_schema.sql
git commit -m "Add migration 001: core schema + RLS for REPLAY"
```

---

## Task 7: Scaffold Cloudflare Worker

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`

- [ ] **Step 1: Init worker package**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npm init -y
npm install --save-dev wrangler@latest typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
npm install @supabase/supabase-js
```

- [ ] **Step 2: Write `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `worker/wrangler.toml`**

```toml
name = "replay-worker"
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "production"
SUPABASE_URL = "https://<ref>.supabase.co"   # replace <ref> with real project ref
REPLAY_SITE_URL = "https://replaycon.in"
BGC_WORKER_URL = "https://api.boardgamecompany.in"
UPI_ID = "suranjanadatta24-1@okaxis"
CF_ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"   # filled in Task 13
CF_ACCESS_AUD = ""                                       # filled in Task 13
```

> Replace `<ref>` and `<team>` with real values from Tasks 3 and 13.

- [ ] **Step 4: Write `worker/src/index.ts` with a health endpoint**

```ts
// worker/src/index.ts

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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cf-Access-Jwt-Assertion",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return json({ ok: true, env: env.ENVIRONMENT });
    }

    return json({ error: "Not found" }, 404);
  },
};
```

- [ ] **Step 5: Add `worker/package.json` scripts**

Edit `worker/package.json` so the `scripts` section reads:

```json
"scripts": {
  "dev": "wrangler dev",
  "deploy": "wrangler deploy",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 6: Commit**

```bash
git add worker/
git commit -m "Scaffold replay worker with /api/health"
```

---

## Task 8: Add Vitest config + smoke test for health endpoint

**Files:**
- Create: `worker/vitest.config.ts`
- Create: `worker/src/index.test.ts`

- [ ] **Step 1: Write `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 2: Write the failing test `worker/src/index.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("worker", () => {
  it("GET /api/health returns ok", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it("unknown path returns 404", async () => {
    const res = await SELF.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npm test
```

Expected: both tests pass.

- [ ] **Step 4: Commit**

```bash
git add worker/vitest.config.ts worker/src/index.test.ts
git commit -m "Add Vitest smoke test for worker health endpoint"
```

---

## Task 9: Port Cloudflare Access JWT verification from bgc

**Files:**
- Create: `worker/src/access-auth.ts`
- Create: `worker/src/access-auth.test.ts`

> This file is a direct port of `bgc-website/worker/src/access-auth.ts`. Copy it verbatim and adapt only the imports/types.

- [ ] **Step 1: Copy access-auth from bgc**

Run:
```bash
cp /Users/siddhantnarula/Projects/bgc-website/worker/src/access-auth.ts \
   /Users/siddhantnarula/Projects/replay-website/worker/src/access-auth.ts
cp /Users/siddhantnarula/Projects/bgc-website/worker/src/access-auth.test.ts \
   /Users/siddhantnarula/Projects/replay-website/worker/src/access-auth.test.ts
```

- [ ] **Step 2: Confirm imports/types still resolve**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npx tsc --noEmit
```

Expected: no type errors. If the bgc file imports anything not present, copy that helper too (likely only Env type — already declared in Task 7).

- [ ] **Step 3: Run access-auth tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add worker/src/access-auth.ts worker/src/access-auth.test.ts
git commit -m "Port Cloudflare Access JWT verification from bgc-website"
```

---

## Task 10: Add Supabase service-role client factory

**Files:**
- Create: `worker/src/supabase.ts`

- [ ] **Step 1: Write the file**

```ts
// worker/src/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./index";

export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add worker/src/supabase.ts
git commit -m "Add Supabase service-role client factory for worker"
```

---

## Task 11: Add bgc cross-call client with test

**Files:**
- Create: `worker/src/bgc-client.ts`
- Create: `worker/src/bgc-client.test.ts`

- [ ] **Step 1: Write the failing test `worker/src/bgc-client.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGuildStatus } from "./bgc-client";

const env = {
  BGC_WORKER_URL: "https://api.boardgamecompany.in",
  REPLAY_TO_BGC_SECRET: "test-secret",
} as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchGuildStatus", () => {
  it("posts phone with bearer token and returns parsed response", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tier: "adventurer", active: true }), { status: 200 })
    );

    const result = await fetchGuildStatus(env, "9999999999");

    expect(result).toEqual({ tier: "adventurer", active: true });
    expect(spy).toHaveBeenCalledWith(
      "https://api.boardgamecompany.in/api/guild-status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ phone: "9999999999" }),
      })
    );
  });

  it("returns {tier:null, active:false} when bgc responds non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const result = await fetchGuildStatus(env, "9999999999");
    expect(result).toEqual({ tier: null, active: false });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- bgc-client`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `worker/src/bgc-client.ts`**

```ts
// worker/src/bgc-client.ts
import type { Env } from "./index";

export type GuildTier = "initiate" | "adventurer" | "guildmaster";

export interface GuildStatus {
  tier: GuildTier | null;
  active: boolean;
}

export async function fetchGuildStatus(env: Env, phone: string): Promise<GuildStatus> {
  try {
    const res = await fetch(`${env.BGC_WORKER_URL}/api/guild-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.REPLAY_TO_BGC_SECRET}`,
      },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) return { tier: null, active: false };
    const body = (await res.json()) as GuildStatus;
    return body;
  } catch {
    return { tier: null, active: false };
  }
}
```

- [ ] **Step 4: Re-run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/bgc-client.ts worker/src/bgc-client.test.ts
git commit -m "Add bgc-client for Guild Path lookups with tests"
```

---

## Task 12: Add signed Apps Script email caller

**Files:**
- Create: `worker/src/apps-script.ts`

- [ ] **Step 1: Write the file**

```ts
// worker/src/apps-script.ts
import type { Env } from "./index";

export interface EmailPayload {
  template: "replay-registration" | "replay-preorder";
  to: string;
  subject: string;
  variables: Record<string, string | number>;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendEmail(env: Env, payload: EmailPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.APPS_SCRIPT_SECRET, body);
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Apps Script returned ${res.status}`);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add worker/src/apps-script.ts
git commit -m "Add signed Apps Script email caller"
```

---

## Task 13: Configure Cloudflare Access for admin gating

**Files:** none modified yet (config in CF dashboard).

> **User action required.**

- [ ] **Step 1: Create CF Access application for admin worker paths**

Dashboard steps:
1. Zero Trust → Access → Applications → Add application → Self-hosted.
2. Name: `Replay Admin`.
3. Domain: `admin.replaycon.in` (we'll wire DNS in later tasks; placeholder is fine).
4. Identity providers: Google (or whatever bgc uses).
5. Policy: Require email in your admin allowlist (start with `siddhantnarula96@gmail.com`).
6. Save. Note the **AUD tag** (Settings → Application → Application Audience (AUD) tag).

- [ ] **Step 2: Find your CF Access team domain**

Zero Trust → Settings → Custom Pages → Team domain shows `<team>.cloudflareaccess.com`.

- [ ] **Step 3: Update `worker/wrangler.toml`**

Replace the placeholders set in Task 7:
- `CF_ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"` → real team domain.
- `CF_ACCESS_AUD = "<aud-tag>"` → real AUD tag from the Replay Admin application.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml
git commit -m "Wire Cloudflare Access team domain + AUD into worker config"
```

---

## Task 14: Set worker secrets

**Files:** none modified.

> **User action required.** Secrets must be set via `wrangler secret put`.

- [ ] **Step 1: Set Supabase service key**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npx wrangler secret put SUPABASE_SERVICE_KEY
```
Paste the `service_role` secret from Task 3.

- [ ] **Step 2: Set admin allowlist**

```bash
npx wrangler secret put ADMIN_EMAILS
```
Paste comma-separated emails (start with `siddhantnarula96@gmail.com`).

- [ ] **Step 3: Generate + set REPLAY_TO_BGC_SECRET**

```bash
openssl rand -hex 32   # copy the output
npx wrangler secret put REPLAY_TO_BGC_SECRET
```
Paste the random hex. **Keep a copy** — you will set this same value on the bgc worker in Task 15.

- [ ] **Step 4: Placeholder Apps Script secrets (real values in Task 16)**

Skip `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` for now; they'll be set after the GAS project exists.

- [ ] **Step 5: Verify secrets are registered**

```bash
npx wrangler secret list
```
Expected output includes `SUPABASE_SERVICE_KEY`, `ADMIN_EMAILS`, `REPLAY_TO_BGC_SECRET`.

---

## Task 15: Add `POST /api/guild-status` to bgc worker

**Files (in `bgc-website` repo):**
- Modify: `worker/src/index.ts` (add route)
- Create: `worker/src/guild-status.ts`
- Create: `worker/src/guild-status.test.ts`

> **Cross-repo work.** Treat this as a small separate PR in `bgc-website`. Operate from `/Users/siddhantnarula/Projects/bgc-website`.

- [ ] **Step 1: Create a feature branch in bgc**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
git checkout main && git pull
git checkout -b feat/guild-status-endpoint
```

- [ ] **Step 2: Write the failing test `worker/src/guild-status.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

describe("POST /api/guild-status", () => {
  beforeAll(() => {
    (env as any).REPLAY_TO_BGC_SECRET = "test-secret";
  });

  it("rejects requests without bearer token", async () => {
    const res = await SELF.fetch("https://x.invalid/api/guild-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "9999999999" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong bearer token", async () => {
    const res = await SELF.fetch("https://x.invalid/api/guild-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
      body: JSON.stringify({ phone: "9999999999" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns {tier:null, active:false} for unknown phone with valid token", async () => {
    const res = await SELF.fetch("https://x.invalid/api/guild-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
      body: JSON.stringify({ phone: "9999999999" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tier: null, active: false });
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd worker && npm test -- guild-status
```
Expected: FAIL — endpoint not implemented.

- [ ] **Step 4: Implement `worker/src/guild-status.ts`**

```ts
// worker/src/guild-status.ts
import { serviceClient } from "./supabase";
import type { Env } from "./index";

export async function guildStatusHandler(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.REPLAY_TO_BGC_SECRET ?? ""}`;
  if (!env.REPLAY_TO_BGC_SECRET || auth !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let phone = "";
  try {
    const body = (await req.json()) as { phone?: string };
    phone = (body.phone ?? "").replace(/\D/g, "").slice(-10);
  } catch {
    return new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (phone.length !== 10) {
    return new Response(JSON.stringify({ tier: null, active: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sb = serviceClient(env);
  const { data } = await sb
    .from("guild_path_members")
    .select("tier, current_state, expires_at")
    .eq("phone", phone)
    .maybeSingle();

  const active =
    !!data &&
    data.current_state === "Active" &&
    (!data.expires_at || new Date(data.expires_at) > new Date());

  return new Response(
    JSON.stringify({ tier: active ? data!.tier : null, active }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
```

> Adjust the column names (`tier`, `current_state`, `expires_at`) if bgc's `guild_path_members` schema differs — check `bgc-website/supabase/migrations/` for the truth. The shape returned to replay (`{tier, active}`) is fixed by this contract.

- [ ] **Step 5: Wire the route into `worker/src/index.ts`**

Locate the `if/else` chain (search for existing `if (path === "/api/lookup-phone"`) and add a new branch alongside it:

```ts
if (path === "/api/guild-status" && req.method === "POST") {
  return guildStatusHandler(req, env);
}
```

Add the import at the top of `worker/src/index.ts`:
```ts
import { guildStatusHandler } from "./guild-status";
```

- [ ] **Step 6: Declare the secret in bgc's Env type**

In `worker/src/index.ts` (or wherever `Env` is declared), add:
```ts
REPLAY_TO_BGC_SECRET: string;
```

- [ ] **Step 7: Re-run tests**

```bash
npm test
```
Expected: all pass including the 3 new ones.

- [ ] **Step 8: Set the secret on bgc worker**

```bash
npx wrangler secret put REPLAY_TO_BGC_SECRET
```
Paste the **same** hex value generated in Task 14 Step 3.

- [ ] **Step 9: Deploy bgc worker**

```bash
npx wrangler deploy
```

- [ ] **Step 10: Smoke test the live endpoint**

```bash
curl -X POST https://api.boardgamecompany.in/api/guild-status \
  -H "Authorization: Bearer <secret>" \
  -H "Content-Type: application/json" \
  -d '{"phone":"9999999999"}'
```
Expected: `{"tier":null,"active":false}`.

- [ ] **Step 11: Commit + open PR in bgc**

```bash
git add worker/src/guild-status.ts worker/src/guild-status.test.ts worker/src/index.ts
git commit -m "Add /api/guild-status endpoint for cross-project Guild lookups"
git push -u origin feat/guild-status-endpoint
gh pr create --title "Add /api/guild-status endpoint" --body "Lets replay-website's worker look up Guild Path membership. Bearer-token auth via REPLAY_TO_BGC_SECRET. Returns {tier, active}."
```

---

## Task 16: Create replay Apps Script project + webhook

**Files:**
- Create: `apps-script/Code.gs`

> **User action required** for the GAS dashboard portion.

- [ ] **Step 1: Create the Apps Script project**

Manual steps:
1. https://script.google.com → New project → name `Replay Email Webhook`.
2. Project Settings → Script properties → Add `WEBHOOK_SECRET` = a fresh `openssl rand -hex 32` value (generate locally; do not reuse the bgc-cross-call secret).

- [ ] **Step 2: Write `apps-script/Code.gs` (reference snippet — paste into GAS)**

```javascript
// apps-script/Code.gs — paste into Apps Script project "Replay Email Webhook"
// Verifies HMAC signature, looks up template, sends via GmailApp.

function doPost(e) {
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  const body = e.postData.contents;
  const signature = e.parameter['X-Signature'] || e.parameter['signature'] || '';

  // Apps Script does not forward custom headers on doPost. If signature
  // isn't in the body itself we accept a query-string fallback. Recommend
  // worker sends signature both as header AND as ?sig=... query param.
  const computed = Utilities.computeHmacSha256Signature(body, secret)
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');

  if (computed !== signature) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'bad signature' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const payload = JSON.parse(body);
  const html = renderTemplate(payload.template, payload.variables);
  GmailApp.sendEmail(payload.to, payload.subject, '', { htmlBody: html, name: 'REPLAY' });
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function renderTemplate(template, vars) {
  const urls = {
    'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/registration.html',
    'replay-preorder':     'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/preorder.html',
  };
  const url = urls[template];
  if (!url) throw new Error('unknown template: ' + template);
  let html = UrlFetchApp.fetch(url).getContentText();
  Object.keys(vars || {}).forEach(function (k) {
    html = html.split('{{' + k + '}}').join(String(vars[k]));
  });
  return html;
}
```

> The actual email templates (`src/emails/registration.html`, `src/emails/preorder.html`) are added in Phase 1. The GAS project just needs to know where to fetch them.

- [ ] **Step 3: Update `worker/src/apps-script.ts` to also pass signature as query param**

Replace the `sendEmail` body to also include `?sig=` (Apps Script's `doPost` cannot read custom headers reliably):

```ts
export async function sendEmail(env: Env, payload: EmailPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.APPS_SCRIPT_SECRET, body);
  const url = new URL(env.APPS_SCRIPT_URL);
  url.searchParams.set("X-Signature", signature);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    body,
  });
  if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
}
```

- [ ] **Step 4: Deploy GAS as Web App**

In Apps Script UI: Deploy → New deployment → Web app → Execute as Me, Access "Anyone" → Deploy. Copy the `/exec` URL.

- [ ] **Step 5: Set Apps Script secrets on worker**

```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npx wrangler secret put APPS_SCRIPT_URL    # paste /exec URL
npx wrangler secret put APPS_SCRIPT_SECRET # paste the secret you set in Step 1
```

- [ ] **Step 6: Commit reference snippet**

```bash
cd /Users/siddhantnarula/Projects/replay-website
git add apps-script/Code.gs worker/src/apps-script.ts
git commit -m "Add replay Apps Script webhook + signed caller (query-param signature)"
```

---

## Task 17: Deploy worker + bind custom domain

**Files:**
- Modify: `worker/wrangler.toml` (add custom domain route)

- [ ] **Step 1: First deploy**

```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npx wrangler deploy
```

Expected: `Published replay-worker` printed; default `*.workers.dev` URL returned.

- [ ] **Step 2: Smoke test the workers.dev URL**

```bash
curl https://replay-worker.<account>.workers.dev/api/health
```
Expected: `{"ok":true,"env":"production"}`.

- [ ] **Step 3: Add custom domain in `worker/wrangler.toml`**

Append:
```toml
[[routes]]
pattern = "api.replaycon.in/*"
custom_domain = true
zone_name = "replaycon.in"
```

> Cloudflare must already have `replaycon.in` as a zone. (It does — GitHub Pages serves the current apex via DNS.)

- [ ] **Step 4: Redeploy**

```bash
npx wrangler deploy
```
Wrangler will create the DNS record + SSL cert for `api.replaycon.in`.

- [ ] **Step 5: Verify**

```bash
curl https://api.replaycon.in/api/health
```
Expected: `{"ok":true,"env":"production"}`. (DNS may take 30-60s to propagate.)

- [ ] **Step 6: Commit**

```bash
git add worker/wrangler.toml
git commit -m "Bind worker to api.replaycon.in"
```

---

## Task 18: Scaffold Astro site (placeholder index)

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `src/pages/index.astro`
- Create: `src/styles/global.css`

- [ ] **Step 1: Init Astro deps**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website
npm init -y
npm install astro@latest @astrojs/react@latest @astrojs/sitemap@latest react@latest react-dom@latest @supabase/supabase-js
npm install --save-dev tailwindcss@latest @tailwindcss/vite@latest @types/react @types/react-dom typescript @astrojs/check
```

- [ ] **Step 2: Write `astro.config.mjs`**

```js
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://replaycon.in",
  integrations: [react(), sitemap()],
  vite: { plugins: [tailwindcss()] },
});
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "worker", "admin"]
}
```

- [ ] **Step 4: Write `src/styles/global.css`**

```css
@import "tailwindcss";

:root {
  --color-replay-orange: #F47B20;
  --color-replay-bg: #FFF8F0;
  --color-replay-ink: #1A1A1A;
  --color-replay-accent: #4A9B8E;
  --color-replay-highlight: #FFD166;
}
```

- [ ] **Step 5: Write `src/pages/index.astro` (placeholder)**

```astro
---
import "../styles/global.css";
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>REPLAY — rebuilding</title>
  </head>
  <body class="bg-[var(--color-replay-bg)] text-[var(--color-replay-ink)]">
    <main class="p-10">
      <h1 class="text-3xl font-bold">REPLAY</h1>
      <p>New site under construction. The current site stays live at <a href="https://replaycon.in">replaycon.in</a> until Phase 1 ships.</p>
    </main>
  </body>
</html>
```

- [ ] **Step 6: Add root scripts**

Edit root `package.json` `scripts`:
```json
"scripts": {
  "dev": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "astro": "astro"
}
```

- [ ] **Step 7: Build to verify**

```bash
npm run build
```
Expected: `dist/` produced without errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tsconfig.json src/
git commit -m "Scaffold Astro site shell with placeholder index"
```

---

## Task 19: Create Cloudflare Pages project for site (preview-only DNS)

**Files:**
- Modify: `.gitignore` (add `dist/`, `.astro/`, `node_modules/` if not present)

> **User action required.** Pages project creation is dashboard-driven.

- [ ] **Step 1: Update `.gitignore`**

Ensure these lines exist:
```
node_modules/
dist/
.astro/
.wrangler/
.DS_Store
*.local
.env
.env.local
```

- [ ] **Step 2: Create Pages project in Cloudflare dashboard**

1. Cloudflare dashboard → Workers & Pages → Create application → Pages → Connect to Git.
2. Select `boredsid/replay-website` repo, production branch `main`.
3. Build settings:
   - Framework preset: Astro
   - Build command: `npm run build`
   - Build output: `dist`
4. Environment variables (Production):
   - `PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
   - `PUBLIC_WORKER_URL` = `https://api.replaycon.in`
   - `PUBLIC_UPI_ID` = `suranjanadatta24-1@okaxis`
5. Save and trigger first deploy.

- [ ] **Step 3: Confirm deploy succeeded on `*.pages.dev`**

After deploy: visit the `replay-website-<hash>.pages.dev` URL — should show the placeholder page.

> **Do NOT** assign `replaycon.in` apex to this Pages project yet. The GitHub Pages workflow still owns the apex; switching DNS happens in Phase 1 cutover.

- [ ] **Step 4: Commit `.gitignore`**

```bash
cd /Users/siddhantnarula/Projects/replay-website
git add .gitignore
git commit -m "Update .gitignore for Astro + worker + Pages build artifacts"
```

---

## Task 20: Scaffold admin SPA (Vite + React + placeholder shell)

**Files:**
- Create: `admin/package.json`
- Create: `admin/vite.config.ts`
- Create: `admin/tsconfig.json`
- Create: `admin/index.html`
- Create: `admin/src/main.tsx`
- Create: `admin/src/App.tsx`

- [ ] **Step 1: Init admin package**

Run:
```bash
cd /Users/siddhantnarula/Projects/replay-website/admin
npm init -y
npm install react@latest react-dom@latest
npm install --save-dev vite@latest @vitejs/plugin-react typescript @types/react @types/react-dom
```

- [ ] **Step 2: Write `admin/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 3: Write `admin/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": false,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write `admin/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>REPLAY Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `admin/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 6: Write `admin/src/App.tsx`**

```tsx
export function App() {
  return (
    <main style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
      <h1>REPLAY Admin</h1>
      <p>Phase 3 will fill this in. Cloudflare Access guards this page.</p>
    </main>
  );
}
```

- [ ] **Step 7: Add admin scripts**

Edit `admin/package.json` `scripts`:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

- [ ] **Step 8: Build to verify**

Run:
```bash
npm run build
```
Expected: `admin/dist/` produced.

- [ ] **Step 9: Commit**

```bash
cd /Users/siddhantnarula/Projects/replay-website
git add admin/
git commit -m "Scaffold admin SPA shell (Vite + React)"
```

---

## Task 21: Create Cloudflare Pages project for admin + bind subdomain

> **User action required.**

- [ ] **Step 1: Create second Pages project**

1. Cloudflare dashboard → Pages → Create application → Connect to Git → same `boredsid/replay-website` repo.
2. Build settings:
   - Root directory: `admin`
   - Build command: `npm run build`
   - Output directory: `admin/dist`
3. Project name: `replay-admin`.
4. Environment variables (Production):
   - `VITE_WORKER_URL` = `https://api.replaycon.in`

- [ ] **Step 2: Bind custom domain `admin.replaycon.in`**

Pages project → Custom domains → Add → `admin.replaycon.in`. Cloudflare auto-creates DNS in the `replaycon.in` zone.

- [ ] **Step 3: Confirm deploy + custom domain serve**

Visit `https://admin.replaycon.in` (may take a minute for cert provisioning). Expected: **Cloudflare Access login wall first** (because Task 13 already created the Access app for this domain), then the placeholder admin page.

- [ ] **Step 4: Verify Access policy blocks non-allowlisted users**

In an incognito window, try to access `admin.replaycon.in` with an email NOT in your allowlist. Expected: blocked at Access.

---

## Task 22: Wire Cloudflare Pages deploy hook into worker secrets

**Files:** none modified.

> **User action required.**

- [ ] **Step 1: Create deploy hook for the site Pages project**

In the **site** Pages project (`replay-website`, not `replay-admin`): Settings → Builds & deployments → Deploy hooks → Add deploy hook → name `Admin Save Rebuild`, branch `main`. Copy the resulting URL.

- [ ] **Step 2: Set it as a worker secret**

```bash
cd /Users/siddhantnarula/Projects/replay-website/worker
npx wrangler secret put CLOUDFLARE_PAGES_DEPLOY_HOOK
```
Paste the URL.

- [ ] **Step 3: Verify**

```bash
npx wrangler secret list
```
Expected: includes `CLOUDFLARE_PAGES_DEPLOY_HOOK`.

---

## Task 23: End-to-end smoke test

**Files:** none modified.

- [ ] **Step 1: Worker health from custom domain**

```bash
curl -s https://api.replaycon.in/api/health
```
Expected: `{"ok":true,"env":"production"}`.

- [ ] **Step 2: Cross-call to bgc**

```bash
SECRET="<the secret from Task 14 Step 3>"
curl -sX POST https://api.boardgamecompany.in/api/guild-status \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"phone":"9999999999"}'
```
Expected: `{"tier":null,"active":false}` (no such phone exists). Try a real Guild phone to verify a positive response.

- [ ] **Step 3: Site Pages preview reachable**

Visit the `*.pages.dev` URL for `replay-website` project. Expected: placeholder page renders.

- [ ] **Step 4: Admin Access-gated reachable**

Visit `https://admin.replaycon.in`. Expected: Access login → after login, placeholder admin page.

- [ ] **Step 5: Apps Script smoke (manual)**

In a worker dev shell (`npm run dev` in `worker/`), POST a test payload to a temporary `/api/test-email` route OR run a one-off script. Optionally skip this step until Phase 1 has real templates — for Phase 0 it's enough to verify the secrets are present and `sendEmail` typechecks.

- [ ] **Step 6: Production-site sanity**

Visit `https://replaycon.in` (the apex, still on GitHub Pages). Expected: current static site renders unchanged. Phase 0 must not have disturbed it.

---

## Task 24: Update CLAUDE.md with Phase 0 learnings

**Files:**
- Modify: `CLAUDE.md` (append to "Session learnings")

- [ ] **Step 1: Append entries**

Append to the bottom of `CLAUDE.md` under "Session learnings":

```markdown
- 2026-05-18 — Phase 0 of rebuild complete: new Supabase project, worker at `api.replaycon.in`, two CF Pages projects (`replay-website`, `replay-admin`), replay Apps Script, bgc `/api/guild-status` cross-call. Current static site at apex still served by GitHub Pages until Phase 1 cutover. **Why it matters:** the old `index.html`/`register.html`/`preorder.html` flow and GAS-with-sheets backend coexist with the new infra during Phase 1 build.
- 2026-05-18 — `apps-script/Code.gs` is a paste-bait reference, mirroring `apps-script-preorder.js`. The real GAS project is named "Replay Email Webhook" and lives in Siddhant's Google account. **Why it matters:** template URL changes in the snippet take effect only after the GAS project is re-pasted; pushing to git is not deployment.
- 2026-05-18 — Worker passes Apps Script HMAC signature as a query param (`?X-Signature=`) because GAS `doPost` cannot read custom request headers reliably. **Why it matters:** if you "fix" `worker/src/apps-script.ts` to only send the header, signature verification will silently fail.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document Phase 0 rebuild learnings"
```

---

## Definition of Done

- [ ] `https://api.replaycon.in/api/health` returns `{ok:true}`.
- [ ] `https://api.boardgamecompany.in/api/guild-status` accepts the shared bearer token and returns guild status.
- [ ] Supabase project has migration 001 applied; RLS denies anon access to private tables.
- [ ] `replay-website` Pages project deploys on push to `main` to a `*.pages.dev` URL.
- [ ] `https://admin.replaycon.in` is reachable, gated by CF Access, and serves the placeholder admin SPA.
- [ ] `https://replaycon.in` still serves the old static site (cutover deferred to Phase 1).
- [ ] All worker secrets set (`SUPABASE_SERVICE_KEY`, `ADMIN_EMAILS`, `REPLAY_TO_BGC_SECRET`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`, `CLOUDFLARE_PAGES_DEPLOY_HOOK`).
- [ ] `worker/` Vitest suite green (`npm test` in `worker/`).
- [ ] `CLAUDE.md` updated with learnings.
