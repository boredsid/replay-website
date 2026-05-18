# REPLAY website rebuild — design

**Date:** 2026-05-18
**Status:** Approved (brainstorm complete; implementation plan pending)
**Repo:** `boredsid/replay-website` (existing repo, wiped to new tree)

## Goal

Replace the current vanilla-HTML + Google Sheets REPLAY site with a scalable, SEO-friendly stack that mirrors `bgc-website` so the project can grow: multiple editions over time, full admin tool, content surface, and clean data model. Visual overhaul lands with the rebuild.

REPLAY is a single annual convention (currently quarterly while growing → eventually annual). This rebuild assumes one headline edition at a time; past editions become read-only archive pages.

## Non-goals

- Shared infra with `bgc-website`. Replay gets its own Supabase, worker, admin, Apps Script. Only coupling: replay's worker calls bgc's worker for Guild Path lookups.
- A new transactional email vendor. Stay on Apps Script (dedicated project for replay).
- A shared product catalog with bgc. Pre-order catalog is per-edition.

## Architecture

Three deployables, mirrors `bgc-website` exactly:

```
replay-website/  (boredsid/replay-website)
├── src/                        Astro 5 site → replaycon.in (Cloudflare Pages)
│   ├── pages/                  Routes: /, /register, /preorder, /schedule, /editions/[slug]
│   ├── components/             React 19 islands + Astro partials
│   ├── content/                MDX/MD collections (about, hero copy, past-edition recaps)
│   ├── lib/                    supabase.ts (anon, public reads), worker.ts, types.ts, source.ts (UTM)
│   └── styles/global.css       Tailwind 4 CSS-config; REPLAY palette overrides
├── admin/                      Vite + React + shadcn → admin.replaycon.in
├── worker/                     Cloudflare Worker → api.replaycon.in
│   └── src/                    Flat if/else router + admin/ subfolder + *.test.ts (Vitest)
├── supabase/migrations/        SQL migrations 001+
├── scripts/                    One-off scripts (e.g. import-historical.ts)
├── apps-script/                Reference snippets for dedicated replay GAS project
└── docs/superpowers/specs/
```

### Boundary rules (match bgc)

- Browser reads `editions`, `sponsors`, `schedule_items`, `products` directly from Supabase via anon key + RLS.
- Anything sensitive — phone lookup, register, pre-order checkout, cancellations, admin — goes through the worker (holds service-role key + signs Apps Script calls).
- **Guild Path lookup:** replay worker → `https://api.boardgamecompany.in/api/guild-status` (new endpoint to be added on bgc worker) with a shared `REPLAY_TO_BGC_SECRET` header. Never duplicate guild data into replay's DB.
- **Email:** replay worker → replay's dedicated Apps Script webhook (signed, separate from bgc's).
- **Admin double-gated:** Cloudflare Access JWT + `ADMIN_EMAILS` allowlist (`worker/src/access-auth.ts` pattern from bgc).
- **SEO / static:** Astro SSG with `@astrojs/sitemap`. DB-driven content (sponsors, schedule, products) baked at build. Admin "Save" triggers Cloudflare deploy hook → rebuild in ~30-60s. About + hero copy live in Astro Content Collections (git-controlled).

### Design system

Reuse bgc's tokens, fonts (Space Grotesk headers / Inter body), component patterns. REPLAY keeps its own orange/green palette overrides via Tailwind 4 CSS config. Same shadcn defaults in admin.

## Data model

Core concept: **edition**. Everything hangs off it.

| Table | Purpose | Public read (RLS) | Key columns |
|---|---|---|---|
| `editions` | One row per REPLAY (1, 2, 3, …) | yes (published only) | `id`, `slug` (`replay-3`), `name`, `start_date`, `end_date`, `venue`, `capacity_per_day` JSONB (`{day1: 60, day2: 58}`), `pricing` JSONB (`{oneshot: {day1: 600, day2: 600}, campaign: 999}`), `registration_status` (`upcoming`/`open`/`sold_out`/`closed`), `is_current` (partial unique index where true) |
| `users` | Phone-keyed people across editions | no | `phone` (10-digit normalized, PK), `name`, `email`, `created_at`, `notes` |
| `registrations` | One row per pass | no | `edition_id`, `user_phone`, `pass_type` (`oneshot`/`campaign`), `days` array (`['day1']` / `['day2']` / `['day1','day2']`), `seats`, `amount_paid`, `discount_applied`, `guild_tier_at_purchase`, `payment_status` (`confirmed`/`pending`/`cancelled`), `source` (UTM JSONB), `created_at` |
| `leads` | Partial-form capture | no | `edition_id`, `phone`, `name?`, `step_reached`, auto-converted on full registration |
| `products` | Pre-order items per edition | yes (current edition only) | `edition_id`, `name`, `category` (`puzzle`/`game`), `mrp`, `reselling_price`, `description`, `image_urls[]`, `metadata` JSONB (piece-count/designer/player-count/etc), `stock?`, `is_available` |
| `orders` | Pre-orders | no | `edition_id`, `user_phone`, `items` JSONB (`[{product_id, qty, price}]`), `total`, `payment_status` |
| `sponsors` | Per-edition | yes | `edition_id`, `name`, `tier` (`title`/`gold`/`silver`/`partner`), `logo_url`, `website_url`, `display_order` |
| `schedule_items` | Per-edition | yes | `edition_id`, `day` (date), `start_time`, `end_time`, `title`, `description`, `location`, `kind` (`workshop`/`tournament`/`open-play`/`meal`/`talk`) |

### Invariants

- `users.phone` is the cross-table join key (10-digit normalized).
- Capacity = sum of `seats` across confirmed `registrations` for the edition + day (matches bgc's per-option weighting).
- Guild Path fraud check (anti-split-abuse, carried over from current site) — any `registrations` row for the phone at this edition blocks a second discounted purchase, regardless of `payment_status`. **Enforced in the worker, not RLS.**
- `editions.is_current = true` enforced as partial unique index. Public homepage queries `editions where is_current = true`.
- `editions.pricing` JSONB shape is locked — admin edits don't require schema migrations.

### Guild Path discount rules (carried over)

| Tier | Discount (oneshot & campaign) | Cap |
|---|---|---|
| Initiate | 20% | none |
| Adventurer | 100% | ₹1,000 max discount |
| Guildmaster | 100% | none |

If `final === 0`, payment sheet bypassed → registration confirmed directly.

## Worker endpoints

**Public:** `POST /api/lookup-phone`, `POST /api/register`, `GET /api/edition-spots/:editionId`, `POST /api/preorder-checkout`, `POST /api/cancel-registration`, `POST /api/lead`.

**Admin** (under `/api/admin/*`, double-gated): mirrors bgc — `whoami`, `summary`, `search`, `log`, `lookup-phone`, `cancel-registration`, `editions` (CRUD + set-current + open/close), `registrations` (list/get/update + `manual` + `export`), `orders` (list/get/update + fulfilled + `export`), `products` (CRUD + image upload + bulk CSV import + toggle availability), `sponsors` (CRUD + drag-reorder + logo upload), `schedule` (CRUD), `users` (list/get/update + credit adjustment + reg history), `leads` (list + patch junk + `export`).

Routing: flat `if/else` chain in `worker/src/index.ts` (same as bgc).

**Cross-project call:** worker → bgc worker `POST /api/guild-status` with `Authorization: Bearer ${REPLAY_TO_BGC_SECRET}` and `{phone}`. Response: `{tier: 'initiate'|'adventurer'|'guildmaster'|null, active: boolean}`. Requires adding this endpoint on bgc side (small separate PR in `bgc-website`).

## Environment

**Astro** (Cloudflare Pages env vars):
- `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_WORKER_URL` = `https://api.replaycon.in`
- `PUBLIC_UPI_ID`

**Worker** (`worker/wrangler.toml [vars]` + `wrangler secret put`):
- vars: `SUPABASE_URL`, `UPI_ID`, `REPLAY_SITE_URL`, `BGC_WORKER_URL`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ENVIRONMENT`
- secrets: `SUPABASE_SERVICE_KEY`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`, `ADMIN_EMAILS`, `REPLAY_TO_BGC_SECRET`, `CLOUDFLARE_PAGES_DEPLOY_HOOK`

**Admin** (Cloudflare Pages env vars):
- `VITE_WORKER_URL` = `https://api.replaycon.in`

## Phasing

Each phase is a separate spec → plan → ship cycle.

### Phase 0 — Infra bootstrap (no user-visible changes)

- New Supabase project; apply migration 001 (core tables + RLS).
- Cloudflare: 2 Pages projects (site + admin), 1 Worker, DNS for `replaycon.in`, `admin.replaycon.in`, `api.replaycon.in`.
- Dedicated replay Apps Script project (templates for registration + pre-order confirmations); signed webhook reachable from worker.
- Cloudflare Access policy for `admin.*` + worker `/api/admin/*`.
- Env vars + secrets in all three targets.
- Add `POST /api/guild-status` endpoint on **bgc worker** (separate PR in `bgc-website`) + shared secret.

### Phase 1 — Site MVP (replaces current replaycon.in)

- Astro 5 + Tailwind 4 + React 19 islands + sitemap scaffold.
- Pages: `/` (landing, hero, sponsors, about), `/schedule`, `/register`, `/preorder`, `/editions/[slug]` (archive).
- Reuse bgc's design system; REPLAY orange/green palette overrides.
- Worker endpoints: `lookup-phone`, `register` (with Guild discount + capacity gating + fraud check, calls bgc for guild status), `edition-spots/:id`, `preorder-checkout`, `cancel-registration`, `lead`.
- UPI payment block reused from bgc pattern.
- Email via replay's GAS webhook (registration + pre-order templates).
- Content: about + hero copy in Astro Content Collections; sponsors + schedule + products in Supabase.
- Cloudflare Pages deploy hook wired so admin "Save" → site rebuild.
- **Cutover:** flip DNS only after parity verified on a preview URL.

### Phase 2 — Historical data import

- `scripts/import-historical.ts` runs once: past REPLAY editions imported from current published-CSV URLs into `editions`, `users`, `registrations`, `orders` (idempotent, safe to re-run).
- Archive pages at `/editions/replay-1`, `/editions/replay-2` render from imported rows.
- Sheets stay as cold backup; no further writes.

### Phase 3 — Admin tool (full bgc parity)

Vite + React + shadcn SPA at `admin.replaycon.in`, double-gated. Screens:

- **Dashboard:** current edition capacity + registrations-today + revenue-to-date + pre-order summary.
- **Editions:** list + create + edit + set `is_current` + open/close registration + edit `pricing` JSONB + edit `capacity_per_day`.
- **Registrations:** list (filter by edition / status / day / pass type), get/update, manual add (walk-ins), CSV export, cancel-with-credit.
- **Pre-orders:** list, get/update, mark fulfilled, CSV export.
- **Products** (per edition): CRUD, image upload (Supabase Storage), bulk import from CSV, toggle availability.
- **Sponsors** (per edition): CRUD with logo upload, drag-reorder, tier assignment.
- **Schedule** (per edition): CRUD, day/time pickers, kind tagging.
- **Users:** list, get/update, credit adjustment, registration history across editions.
- **Leads:** list, mark junk, export, see conversion outcome.
- **Audit log:** every admin write logged with actor email + timestamp + diff (matches bgc's `/api/admin/log`).

Sponsor/schedule/product edits trigger Cloudflare deploy hook → site rebuilds. Worker `/api/admin/*` mirrors bgc structure; admin SPA uses a typed client.

### Phase 4 — Polish + post-launch (TBD, out of scope for initial planning)

- Past-edition recap content (photos, stats, blog) in Content Collections.
- Press kit page.
- Email open/click tracking if needed.
- Lead-nurture automation.

## Open questions for implementation

- Exact REPLAY palette tokens (current site uses CSS custom props in `:root` of `index.html`) — extract and translate to Tailwind 4 CSS-config during Phase 1.
- Whether `/api/guild-status` on bgc needs to also return guild expiry — likely yes for "Active" check parity.
- Image hosting: Supabase Storage vs Cloudflare R2 for product / sponsor logos. Default to Supabase Storage for Phase 3 unless a quota issue surfaces.
