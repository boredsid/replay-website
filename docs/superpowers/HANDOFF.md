# REPLAY rebuild — handoff

**Last updated:** 2026-06-02
**Current branch:** `main` (production)
**Status:** Phase 1 (incl. 1F email rework), Phase 2 historical import, **Phase 3A admin foundation**, and **Phase 3B (editions CRUD + users + manual-add edition selector)** all shipped. The 2026-08-17 fundamentals hardening added registration/payment integrity, current-edition enforcement, capacity serialization, accessibility/SEO/security improvements, dependency upgrades, data-sanity tooling, and a signed replacement email webhook. Apex `https://replaycon.in/` runs on the Astro + Cloudflare Pages + Supabase + Worker stack. Phase 3C (products/orders/sponsors/schedule) and the dedicated live-event-readiness/privacy session remain intentionally deferred.

This doc orients a new session. For low-level patterns, gotchas, and discovered facts, read `AGENTS.md` first — that's where durable learnings live. This doc is the higher-level "where are we, what's next."

## Live state

| Surface | URL | Notes |
|---|---|---|
| Public site | `https://replaycon.in/` | Astro 6, deployed from `main` via Cloudflare Pages |
| Public site (www) | `https://www.replaycon.in/` | Same Pages project, same DNS |
| Worker API | `https://api.replaycon.in/api/health` | Cloudflare Worker, deployed manually via `cd worker && npx wrangler deploy` |
| Admin | `https://admin.replaycon.in/` | CF Access gated; working operations console |
| Supabase project | ref `qvkynwlmzeybdiapbcsy` | RLS enabled; migrations through `advisor_hardening` applied |
| bgc worker (cross-call) | `https://api.boardgamecompany.in/api/guild-status` | Used by replay worker for Guild Path lookup |
| Replay Apps Script | `REPLAY Email Webhook` GAS project | Deployment replaced and signature-tested on 2026-08-17. URL and HMAC key live only in the Worker `APPS_SCRIPT_URL` / `APPS_SCRIPT_SECRET` bindings; `WEBHOOK_SECRET` is the matching GAS Script Property. Reads templates from `main` on raw.githubusercontent.com |

**Production edition state (replay-3):**
- `slug='replay-3'`, `name='REPLAY'`, dates `2026-09-12 → 2026-09-13`, venue `'TBD'`
- `is_current=true`, `is_published=true`
- `registration_status='upcoming'` — site shows the notify-me form, not the registration form
- Capacity: 250/250
- Pricing: oneshot ₹800/day, campaign ₹1400, adventurer_cap ₹1000

**To open registration when ready:**
```sql
update editions set registration_status='open' where slug='replay-3';
```
Then trigger the rebuild from the admin or use the worker secret `CLOUDFLARE_PAGES_DEPLOY_HOOK`. Never store the raw hook URL in the repository. Wait about 60 seconds for the rebuild.

## Phases shipped

All have a spec in `docs/superpowers/specs/` and a plan in `docs/superpowers/plans/` (matching `YYYY-MM-DD-replay-phase-*` naming):

| Phase | What | Key artifact paths |
|---|---|---|
| **0** | Infra bootstrap | New Supabase + Worker + 2 Pages projects + DNS + Apps Script + CF Access + bgc cross-call PR. Worker at `worker/`, shell pages at `src/pages/index.astro`, admin shell at `admin/`. |
| **1A** | Worker layer + edition seed | 5 endpoints (`lookup-phone`, `register`, `edition-spots`, `cancel-registration`, `lead`) + REPLAY 3 seed at `supabase/seeds/replay-3.sql`. 66 worker tests. |
| **1B** | Site pages | 3 Astro pages (`/`, `/register`, `/schedule`) + 3 React islands (`RegisterForm`, `NotifyMeForm`, `LiveSpotsBadge`). Content collections at `src/content/landing/`. 25 site tests. |
| **1C** | Initial design pass | Brutalist primitives ported from bgc — `.btn`, `.card-brutal`, `.pill`, `.input-brutal` in `src/styles/global.css`. Replay-distinct palette (orange + teal + violet). |
| **1D** | Cutover | Apex DNS swapped from GitHub Pages → Cloudflare Pages. Legacy `*.html` deleted from `main`. `legacy-static` branch retained as safety. |
| **1E** | Major visual redesign | 4 new shared components (`HeroPhotoBand`, `EditorialStripe`, `DarkBand`, `SponsorsBand`). Full bgc palette match. Yellow event-capacity band with bgc-style combined progress bar. Hero on cream, Guild Path on ink. |
| **1F** | Email rework + edition_name fix | `src/emails/registration.html` reskinned to 1E identity, four new content blocks (what to expect / add to calendar / schedule + venue / share + social). Worker now formats `edition_name` as `"REPLAY 3rd edition"` (fix), dates as `"Sep 12 – Sep 13"`, and capitalises `guild_tier`. New helpers in `worker/src/format.ts` (`editionOrdinal`, `shortDate`, `shortDateRange`, `capitalize`) + `worker/src/calendar.ts` (Google + WhatsApp URL builders) + `worker/src/ics.ts` (`GET /api/ics/:slug.ics`). 90 worker tests. |
| **2** | Historical edition import | Idempotent `scripts/import-historical.ts` (`npm run import:historical [-- --dry-run]`, tsx) loads replay-1/replay-2 registrations + replay-2 orders from **gitignored** `scripts/data/*.csv` into Supabase. Pure parse/map in `scripts/lib/csv.ts` + `scripts/lib/mappers.ts` (37 unit tests). Editions seeded by `supabase/seeds/replay-1-2.sql`. Live data imported: replay-1 = 50 regs (44 confirmed), replay-2 = 103 regs (97 confirmed, incl. **21 phone-less walk-ins** — each its own user with a sequential synthetic phone `0000000000`–`0000000020`, `users.name` = the walk-in's name, `source.guest_name` kept as marker), 13 orders (₹58,513). 142 users total (121 real + 21 synthetic). Delete-by-edition + reinsert = idempotent (synthetic phones reproduced deterministically by file/row order); deletes scoped to the two historical slugs so replay-3 is never touched; users upserted by phone. |

## Phases pending

Roughly in order of dependency / value.

### "Open registration for REPLAY 3"

- **Scope:** single SQL flip + fire deploy hook. Already documented above.
- **Effort:** 5 minutes when user is ready.
- **Dependencies:** business readiness (venue + schedule + sponsors locked in).

### Pre-order checkout (1B-extra)

- **Scope:** `/preorder` page + `preorder-checkout` worker endpoint + products seed for replay-3 + preorder confirmation email template (`src/emails/preorder.html`).
- **Effort:** ~2-3 days.
- **Dependencies:** product catalog needs to exist (real product rows seeded into `products` table by edition).
- **Reference shape:** legacy `preorder.html` flow on `legacy-static` branch — has cart, UPI bottom-sheet, hardcoded pass-holder gate. The new build replaces the JSONP/CSV + Apps Script flow with worker endpoints against Supabase.
- **What's already wired:** `products` + `orders` tables exist; `apps-script.ts` already supports `template: 'replay-preorder'` (see `EmailPayload` type); GAS `Code.gs` already references `https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/preorder.html` — that file just doesn't exist yet.
- **Email template reuse:** copy `src/emails/registration.html` as the starting point, swap pass-details for line items + cart total. The `worker/src/format.ts` helpers (`shortDateRange`, `capitalize`, `editionOrdinal`) plus `worker/src/calendar.ts` URL builders are ready to feed the same placeholder set.

### Past editions footer page

- **Scope:** new `/past-editions` route linked from footer. Showcases prior REPLAY editions — photos, stats ("X attendees · Y games played · Z tournaments"), "what happened" blurb.
- **Effort:** ~1 day for the page itself.
- **Dependencies:** Phase 2 data is now imported (replay-1/replay-2 registrations + orders in Supabase), so live stats are available — OR seed with hardcoded MDX content. Hardcoded approach: add `src/content/editions/replay-1.mdx`, `replay-2.mdx` with frontmatter (date, attendee count, photos, blurb) and render via Astro Content Collection — same pattern as `src/content/landing/`.
- **Design starting point:** use `EditorialStripe` + `HeroPhotoBand` components from Phase 1E. Each edition gets one editorial stripe.
- **Stat caveat:** replay-2's 21 walk-ins each have their own synthetic-phone user (`0000000000`–`0000000020`), so unique-attendee counts by distinct phone are correct. They are just placeholder phones, not real numbers — filter on the `0000000xxx` range (or `source.guest_name is not null`) if you need to exclude/flag them.

### Correct replay-2 walk-in placeholder phones (small follow-up)

- **Scope:** the 21 phone-less replay-2 walk-ins each imported as their own user with a sequential synthetic phone `0000000000`–`0000000020` and `users.name` set to the walk-in's name (also kept in `registrations.source ->> 'guest_name'`). When the organiser collects real phone numbers, update each synthetic user's `phone` (cascading to its one registration) to the real number.
- **Effort:** minutes, manual — `select u.phone, u.name from users u where u.phone ~ '^00000000[0-9][0-9]$' order by u.phone` then per-person `update users set phone=… where phone='0000000xxx'` (FK `on update` is restrict, so update the registration's `user_phone` too, or insert the real user + repoint the registration).
- **Note:** re-running `npm run import:historical` reproduces the SAME synthetic phones (deterministic by row order) — it won't recover real numbers; corrections are a DB step (or fix the source CSV first).

### Migrate user identity from phone PK → surrogate UUID (tech debt)

- **Scope:** today `users.phone` (10-digit text) is the primary key, and `registrations.user_phone` + `orders.user_phone` FK to it. Phone is the natural key everywhere (registration lookup, Guild-Path fraud check, bgc guild cross-call, historical-import dedup), but it makes a user's phone effectively immutable and conflates "identity" with "contact info". Migrate to a surrogate `users.id uuid primary key`, demote `phone` to a unique-but-mutable attribute, and repoint registrations/orders to `user_id`.
- **Why it matters:** (1) more scalable / conventional — identity shouldn't be a mutable contact field; (2) lets admins freely edit any user's phone number (typos, number changes), not just the walk-in placeholders; (3) removes the need for the `ON UPDATE CASCADE` workaround added in Phase 3B (see below) — phone edits stop being FK-sensitive entirely.
- **Blast radius:** `users`, `registrations`, `orders` schema; every worker file that selects/joins/inserts by `user_phone` (`register.ts`, `lookup-phone.ts`, `cancel-registration.ts`, `admin/registrations.ts`, `admin/users.ts`, `editions.ts` capacity queries); `scripts/lib/mappers.ts` + import orchestrator (dedup keys on phone); admin `RegistrationRow`/`UserRow` types. Medium-large; do it as its own spec → plan, not folded into a feature phase. Must run against the live production DB with imported replay-1/2/3 data, so back up + dry-run first.
- **Note:** Phase 3B deliberately did NOT do this — it added `ON UPDATE CASCADE` to the two phone FKs as a cheap interim so the walk-in phone fix (and any phone edit) works today. This task supersedes that workaround.

### Configurable event length — full N-day support (design later)

- **Context:** Phase 3B shipped a STOPGAP (2026-06-08) so the admin can edit editions of any length and the worker validates a variable `day1..dayN` pricing/capacity map (unblocked editing replay-1, a real 1-day edition). But several surfaces still assume EXACTLY 2 days and need a proper redesign before a non-2-day edition can take live registrations:
  - `worker/src/validation.ts` — `KNOWN_DAYS = ['day1','day2']`, `parseDays` only accepts day1/day2; `Day` type is `'day1'|'day2'`.
  - `worker/src/register.ts` — campaign requires exactly day1+day2 (`days.length !== 2`).
  - `worker/src/editions.ts` `getConfirmedSeatsByDay` + `edition-spots.ts` — hardcode `day1`/`day2`.
  - `worker/src/editions.ts` `dayLabel` / `DAY_NAMES` — `day1=Saturday, day2=Sunday` (assumes a weekend).
  - Public site: register form day selectors, capacity gating, and the schedule's Sat/Sun tabs (`ScheduleDay.astro`, schedule page) are 2-day.
- **Scope:** generalize "days" to N (derive count from the edition's `start_date..end_date` span; key everything `day1..dayN`; label days by actual date, not Sat/Sun). Touches worker validation/register/spots/capacity + the public register + schedule UIs. Historical replay-1 (1-day) and replay-2/3 (2-day) data already fits the `day1..dayN` map.
- **Dependencies:** none hard. Do it as its own brainstorm → spec → plan. The current edition (replay-3) is 2-day, so there's no live urgency until a 1-day or 3-day edition needs to open registration.

### BGC credit redemption at replay checkout

- **Scope:** let a replay pass purchase apply the buyer's BGC store-credit balance, mirroring how bgc's own registration redeems credits. BGC keeps an append-only `user_credits` ledger (bgc `supabase/migrations/008_user_credits.sql` + `009_user_credits_idempotent.sql`; balance = `sum(amount)` per user). Replay worker cross-calls bgc (same bearer-token pattern as `guild-status`, secret `REPLAY_TO_BGC_SECRET`) for (a) balance lookup by phone→user_id and (b) an atomic redemption when a purchase is confirmed. Net price becomes `base − guild_discount − credits_applied`, floored at 0.
- **Why it matters now:** replay-2's historical data already shows "X Credits Used" rows (see Phase 2 import) — credit usage is a real part of the flow, just not yet wired into the new stack.
- **Dependencies:**
  - bgc must expose credit endpoints behind the shared secret (`GET` balance + `POST` redeem). Today bgc credits are internal only (`bgc-website/worker/src/credits.ts`, `cancel.ts`) with no replay-facing API — that endpoint pair needs adding on the bgc side first.
  - Redemption must be **idempotent and reversible**: a later replay-side cancellation has to post a credit reversal keyed by the replay registration id. bgc already enforces one-redeem / one-reversal per registration via the `user_credits_one_*_per_reg` unique indexes — replay must pass its registration id as that key.
- **Schema:** add `credits_applied int not null default 0` to replay `registrations` (bgc added the equivalent on its side in migration 008).
- **Note:** the Phase 2 historical import does **not** backfill credit usage — replay-2's "X Credits Used" rows are folded into the gross `discount_applied` number. This phase is forward-only.
- **Reference shape:** bgc `worker/src/credits.ts`, `worker/src/cancel.ts`, `worker/src/guild-purchase.ts`, migrations 008/009.

### Promo codes

- **Scope:** percentage or fixed-amount promo codes applied at registration checkout (optionally pre-order too). New `promo_codes` table (`code`, `type` ∈ {percent, fixed}, `value`, `max_uses`, `used_count`, `valid_from`, `valid_until`, edition scope), worker validates + applies inside `worker/src/pricing.ts` / `register.ts`, and records the applied `promo_code` on the registration row.
- **Dependencies:** none hard, but the **stacking precedence** with guild discount and credits must be defined. Recommended order: `base → guild discount → promo → credits`, floored at 0. Lock this before implementing so all three discount sources compose deterministically.
- **Effort:** ~1–2 days (table + worker price-calc changes + an admin CRUD screen, which folds into Phase 3 admin).

### Phase 3 — full admin tool

- **Scope:** Vite + React + shadcn SPA at `admin.replaycon.in` (shell already deployed at `admin/`, currently a placeholder). 9 CRUD screens — dashboard, editions, registrations, pre-orders, products, sponsors, schedule, users, leads. Audit log table already exists. Deploy-hook integration so admin saves rebuild the site (worker secret `CLOUDFLARE_PAGES_DEPLOY_HOOK` ready).
- **Effort:** multi-week.
- **Dependencies:** none architectural; everything's wired. CF Access already gates the domain.
- **Starting moves:**
  1. Mirror bgc admin structure — `/Users/siddhantnarula/Projects/bgc-website/admin/` has the working pattern (Vite + React + shadcn + react-router + CF Access JWT verification).
  2. Worker side: add `/api/admin/*` routes to `worker/src/index.ts` gated by `access-auth.ts` (`verifyAccessJwt` already exists, used in `cancel-registration.ts` lines 17-25 as the reference pattern).
  3. First screen: dashboard with edition-spots, recent registrations, recent leads. Worker has all the queries already (`getEditionById`, `getConfirmedSeatsByDay`).
  4. Second screen: edition CRUD — flip `registration_status` from `upcoming` → `open` → `sold_out` → `closed` via admin instead of SQL.
- **Status — Phase 3A shipped (2026-06-02):** the `/api/admin/*` gate + dispatch now exists in `worker/src/index.ts` (handlers in `worker/src/admin/`), and the SPA screens (Dashboard, Registrations incl. manual add + confirm/cancel, Leads, Audit) are built in `admin/`. Auth transport is **same-origin**: the SPA calls relative `/api/admin/*` on `admin.replaycon.in`, served by a Workers route `admin.replaycon.in/api/admin/*` (the admin host is already behind the CF Access app, AUD `0983cd2a…132f` = worker `CF_ACCESS_AUD`, so CF injects `Cf-Access-Jwt-Assertion`). Cross-origin to `api.replaycon.in/api/admin` was abandoned because CF Access 403s cookie-less CORS preflights — do not reintroduce it (see the `AGENTS.md` learning). Deferred 3A follow-ups: dashboard recent-regs/leads lists not yet rendered; `RegistrationDrawer` `id`-undefined guard; debounce on registrations search.
- **Status — Phase 3B shipped (2026-06-07):** Editions screen (list/create/edit — flip `registration_status`/`is_published`/`is_current`, edit dates/venue/pricing/capacity, create new editions; "Rebuild site now?" confirm after save), Users screen (list/search, edit name/email/notes, view a user's registrations+orders, guarded change-phone), and an edition selector + non-binding base-price hint on manual-add. Worker handlers in `worker/src/admin/editions.ts` + `users.ts`; SPA pages in `admin/src/pages/Editions*.tsx`/`EditionDrawer.tsx`/`Users*.tsx`/`UserDrawer.tsx`. **Migration 003** added `on update cascade` to the phone FKs and widened `admin_audit_log.target_id` to `text`. **Migration 004** later restored a database-enforced single current edition, and both public/Worker current-edition lookups now require `is_current=true`. Spec `docs/superpowers/specs/2026-06-07-replay-phase-3b-editions-users-design.md` + plan `.../plans/2026-06-07-replay-phase-3b-editions-users.md`. **Remaining (3C):** products, orders, sponsors, schedule screens. Manual-reg pricing automation was deliberately NOT built (organiser chose to keep amount manual; selector + base-price hint only).

### Playwright E2E (hardening phase)

- **Scope:** cover happy paths through landing/register/schedule + worker integration tests. Originally scoped in Phase 1D, punted.
- **Effort:** ~1 day for a meaningful suite.
- **Dependencies:** none.
- **Starting move:** `npx playwright install` (no existing config yet). Smallest meaningful suite: 3 happy-path specs (landing renders, register form submits, schedule lists items) + 1 worker contract test (`/api/edition-spots/:id` returns correct shape). Wire as a separate `npm run test:e2e` so it doesn't slow the unit suites.

## Operational facts

### Branches
- `main` — production (CF Pages auto-deploys on push)
- `legacy-static` — pre-rebuild snapshot, full git safety net
- No active feature branches

### Secrets (worker)
Stored via `wrangler secret put`. Visible via `cd worker && npx wrangler secret list`:
- `SUPABASE_SERVICE_KEY` — RLS bypass for worker
- `ADMIN_EMAILS` — comma-separated allowlist (8 emails currently)
- `REPLAY_TO_BGC_SECRET` — bearer token for cross-calling bgc worker (same value set on bgc worker side)
- `APPS_SCRIPT_URL` — `/exec` URL of Replay Email Webhook GAS project
- `APPS_SCRIPT_SECRET` — HMAC secret matching GAS Script Property `WEBHOOK_SECRET`
- `CLOUDFLARE_PAGES_DEPLOY_HOOK` — webhook URL to trigger site rebuilds from worker (admin save → site refresh)

### Cloudflare Pages projects
- `replay-website` (the site) — production branch `main`, build cmd `npm run build`, output `dist`
- `replay-admin` — production branch `main`, root dir `admin`, build cmd `npm run build`, output `admin/dist`. CF Access gated.

### Cloudflare Access
- Team domain `boardgamecompany.cloudflareaccess.com` (shared with bgc — same Zero Trust org)
- Replay Admin app AUD: `0983cd2ae4c9939c15d1ebecabe9d57a9630e8b09ada408279a9b17d3ecf132f`
- Allowlist: `siddhantnarula96@gmail.com`, `musafiramrit@gmail.com`, `suranjanadatta24@gmail.com`, `swapnilsr21@gmail.com`, `chughyogesh01@gmail.com`, `kishorerubik97@gmail.com`, `movinbgiri08@gmail.com`, `rohithdabbiru@gmail.com`

### Local dev
- `.env.local` at repo root needs: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_WORKER_URL=https://api.replaycon.in`, `PUBLIC_UPI_ID=suranjanadatta24-1@okaxis`. Without it, build pauses 30-50s/page on Supabase timeout against placeholder URL.
- `npm run dev` (Astro on :4321), `cd worker && npm run dev` (Worker on :8787 — for endpoint dev only; production worker is what site fetches by default). Worker local dev needs `worker/.dev.vars` with `SUPABASE_SERVICE_KEY` + any other secrets you want exercised; otherwise endpoints that query Supabase will fail.
- `npm test` at root (25 site tests), `cd worker && npm test` (90 worker tests)

### Dev dep versions (pinned)
Avoid `npm install --save-dev pkg@latest` for the following — Astro 6.3.3 internally uses vite 7; latest plugins want vite 8 and crash the build:
- `vitest@^3`
- `@vitejs/plugin-react@^5`
- `@tailwindcss/vite@4.2`
- `tailwindcss@4.2`

### Cloudflare Pages quirks
- Pages dedupes file uploads by hash. If a build is broken at the edge (500), an `--allow-empty` commit will NOT force re-upload — needs a real file change. Adding a comment to a CSS file or appending to AGENTS.md works.
- Branch deploy URL format: `<branch-slug>.replay-website.pages.dev` (e.g. `redesign-phase-1e.replay-website.pages.dev`). Aliases can get stuck post-outage even when individual deployment URLs work.
- Need `dist/404.html` for real 404s; without it Pages falls back to serving index content at 200.
- Static assets referenced by absolute path (`/replay-logo.png`) MUST live in `public/`, not repo root. Legacy GitHub Pages served whatever was at root — that's gone now.

### CSS hex-case gotcha
Astro minifier lowercases hex colors (`#1A0088` → `#1a0088`). Case-sensitive grep on dist CSS will miss matches. Always lowercase when searching dist.

## Where things live

```
docs/superpowers/
├── HANDOFF.md                              (this file)
├── specs/
│   ├── 2026-05-18-replay-rebuild-design.md        (master spec)
│   ├── 2026-05-21-replay-phase-1a-worker-design.md
│   ├── 2026-05-21-replay-phase-1b-site-pages-design.md
│   ├── 2026-05-22-replay-phase-1c-design-overhaul-design.md
│   ├── 2026-05-22-replay-phase-1d-cutover-design.md
│   ├── 2026-05-22-replay-phase-1e-design-redesign.md
│   └── 2026-05-24-replay-phase-1f-email-rework-design.md
└── plans/
    ├── 2026-05-18-replay-phase-0-infra.md
    ├── 2026-05-21-replay-phase-1a-worker.md
    ├── 2026-05-21-replay-phase-1b-site-pages.md
    ├── 2026-05-22-replay-phase-1c-design-overhaul.md
    ├── 2026-05-22-replay-phase-1d-cutover.md
    ├── 2026-05-22-replay-phase-1e-design-redesign.md
    └── 2026-05-24-replay-phase-1f-email-rework.md

src/
├── pages/                                  Astro routes
├── layouts/Layout.astro                    HTML shell + dark nav + footer
├── components/                             Astro + React; brutalist shared primitives
├── content/landing/                        MDX collection for hero + about copy
├── lib/                                    supabase, worker, data, types helpers
├── styles/global.css                       Single source for design tokens + .btn/.pill/etc
├── emails/registration.html                Confirmation email template
└── assets/landing/                         Hero photos (Astro Image optimized)

worker/                                     Cloudflare Worker (90 tests)
admin/                                      Vite + React SPA shell (Phase 3 fills in)
supabase/migrations/                        001 schema + RLS, 002 leads unique index
supabase/seeds/                             replay-3 edition seed
apps-script/Code.gs                         Paste-bait reference for the GAS project
scripts/                                    Phase 2 historical import (import-historical.ts + lib/ + data/ gitignored)
```

`AGENTS.md` at repo root has the durable session learnings — read it before assuming anything about why a thing is the way it is. Every gotcha I hit during Phase 1 is recorded there.

## How to pick up

For any non-trivial phase below, the established workflow is **brainstorm → spec → plan → implement** via superpowers skills, with subagent-driven execution. Past phases use this verbatim — read any spec under `docs/superpowers/specs/` for the shape (the 1F spec is the most recent reference).

1. **Open registration for REPLAY 3** — SQL flip + deploy-hook recipe at the top of this doc. 5-min task, no brainstorming needed.

2. **Pre-order checkout** — biggest scope-wise. Start by reading legacy `preorder.html` on `legacy-static` branch to understand UX expectations (cart, UPI bottom-sheet, pass-holder gate), then design fresh against the Supabase `products` + `orders` tables. New page `/preorder` + new worker endpoint + product seed + `src/emails/preorder.html`. Email template should start by copying `registration.html` (same brutalist shell) — swap pass details for line-item table + cart total.

3. **Phase 2: historical import** — write the import script as a one-off in `scripts/import-historical.ts`. Read CSV URLs from `git show legacy-static:CLAUDE.md`. Idempotent dedup by `(phone, edition_id)`. Use service-role to bypass RLS. Will need to seed replay-1 and replay-2 rows in `editions` first.

4. **Past editions page** — depends on Phase 2 OR seed with hardcoded MDX. Hardcoded path is faster and lets the page ship before historical import. Use Astro Content Collection mirroring `src/content/landing/` structure; render with `EditorialStripe` + `HeroPhotoBand` components.

5. **Phase 3: admin** — multi-week. Mirror bgc admin (`/Users/siddhantnarula/Projects/bgc-website/admin/`). Worker side: add `/api/admin/*` routes gated by `verifyAccessJwt` (pattern in `worker/src/cancel-registration.ts`). Site side: build out `admin/` SPA starting with dashboard, then edition CRUD. Wire CF Pages deploy hook so admin saves rebuild the public site.

6. **Playwright E2E** — punted from 1D. ~1 day for a meaningful suite. Keep separate from unit suites (`npm run test:e2e`).

The next session can read `AGENTS.md` + this file + the master spec at `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md` and be fully oriented in ~10 minutes.
