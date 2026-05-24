# REPLAY rebuild — handoff

**Last updated:** 2026-05-24
**Current branch:** `main` (production)
**Status:** Phase 1 shipped end-to-end (including 1F email rework). Apex `https://replaycon.in/` runs on the new Astro + Cloudflare Pages + Supabase + Worker stack with bgc-aligned visual identity.

This doc orients a new session. For low-level patterns, gotchas, and discovered facts, read `CLAUDE.md` first — that's where durable learnings live. This doc is the higher-level "where are we, what's next."

## Live state

| Surface | URL | Notes |
|---|---|---|
| Public site | `https://replaycon.in/` | Astro 6, deployed from `main` via Cloudflare Pages |
| Public site (www) | `https://www.replaycon.in/` | Same Pages project, same DNS |
| Worker API | `https://api.replaycon.in/api/health` | Cloudflare Worker, deployed manually via `cd worker && npx wrangler deploy` |
| Admin (placeholder) | `https://admin.replaycon.in/` | CF Access gated; SPA shell only — Phase 3 fills it in |
| Supabase project | ref `qvkynwlmzeybdiapbcsy` | 9 tables, RLS, migration 002 applied |
| bgc worker (cross-call) | `https://api.boardgamecompany.in/api/guild-status` | Used by replay worker for Guild Path lookup |
| Replay Apps Script | `Replay Email Webhook` GAS project | URL hardcoded in `APPS_SCRIPT_URL` worker secret. Reads templates from `main` branch raw.githubusercontent |

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
Then fire the CF Pages deploy hook (worker secret `CLOUDFLARE_PAGES_DEPLOY_HOOK` — also at this raw URL: `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/01e9488c-00cc-4c38-aa87-9be5820a51f7`). Wait ~60s for rebuild.

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

## Phases pending

Roughly in order of dependency / value.

### "Open registration for REPLAY 3"

- **Scope:** single SQL flip + fire deploy hook. Already documented above.
- **Effort:** 5 minutes when user is ready.
- **Dependencies:** business readiness (venue + schedule + sponsors locked in).

### Pre-order checkout (1B-extra)

- **Scope:** `/preorder` page + `preorder-checkout` worker endpoint + products seed for replay-3 + preorder confirmation email template.
- **Effort:** ~2-3 days.
- **Dependencies:** product catalog needs to exist. Bundle this with Phase 1F (email rework) if doing both.
- **Reference:** legacy `preorder.html` flow shape; current Supabase has `products` and `orders` tables ready.

### Phase 2 — historical edition import

- **Scope:** import replay-1, replay-2 from the legacy Google Sheets into Supabase `users`, `registrations`, `orders` tagged by edition. Idempotent script at `scripts/import-historical.ts`.
- **Effort:** ~1-2 days. Most of the work is CSV parsing + dedup logic against existing replay-3 rows.
- **Dependencies:** the legacy sheet CSV URLs (already documented in pre-rebuild `CLAUDE.md`). RLS bypass via service-role.
- **Why now might matter:** unblocks the "Past editions" page below.

### Past editions footer page (new final phase, replaces archive page)

- **Scope:** new `/past-editions` (or similar) route linked from footer. Showcases prior REPLAY editions — photos, stats, "what happened."
- **Effort:** ~1 day for the page itself. Design TBD.
- **Dependencies:** Phase 2 (need imported data) OR seed with hardcoded MDX content for now.

### Phase 3 — full admin tool

- **Scope:** Vite + React + shadcn SPA at `admin.replaycon.in` (shell already deployed, currently a placeholder). 9 CRUD screens — dashboard, editions, registrations, pre-orders, products, sponsors, schedule, users, leads. Audit log table already exists. Deploy-hook integration so admin saves rebuild the site.
- **Effort:** multi-week. Mirror bgc admin structure (`/Users/siddhantnarula/Projects/bgc-website/admin/`).
- **Dependencies:** none architectural; everything's wired. CF Access already gates the domain.

### Playwright E2E (hardening phase)

- **Scope:** cover happy paths through landing/register/schedule + worker integration tests. Originally scoped in Phase 1D, punted.
- **Effort:** ~1 day for a meaningful suite.
- **Dependencies:** none.

## Operational facts

### Branches
- `main` — production (CF Pages auto-deploys on push)
- `legacy-static` — pre-rebuild snapshot, full git safety net
- No active feature branches

### Secrets (worker)
Stored via `wrangler secret put`. Visible via `cd worker && npx wrangler secret list`:
- `SUPABASE_SERVICE_KEY` — RLS bypass for worker
- `ADMIN_EMAILS` — comma-separated allowlist (5 emails currently)
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
- Allowlist: `siddhantnarula96@gmail.com`, `amritkochar.007@gmail.com`, `suranjanadatta24@gmail.com`, `swapnilsr21@gmail.com`, `chughyogesh01@gmail.com`

### Local dev
- `.env.local` at repo root needs: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_WORKER_URL=https://api.replaycon.in`, `PUBLIC_UPI_ID=suranjanadatta24-1@okaxis`. Without it, build pauses 30-50s/page on Supabase timeout against placeholder URL.
- `npm run dev` (Astro on :4321), `cd worker && npm run dev` (Worker on :8787 — for endpoint dev only; production worker is what site fetches by default)
- `npm test` at root (25 site tests), `cd worker && npm test` (66 worker tests)

### Dev dep versions (pinned)
Avoid `npm install --save-dev pkg@latest` for the following — Astro 6.3.3 internally uses vite 7; latest plugins want vite 8 and crash the build:
- `vitest@^3`
- `@vitejs/plugin-react@^5`
- `@tailwindcss/vite@4.2`
- `tailwindcss@4.2`

### Cloudflare Pages quirks
- Pages dedupes file uploads by hash. If a build is broken at the edge (500), an `--allow-empty` commit will NOT force re-upload — needs a real file change. Adding a comment to a CSS file or appending to CLAUDE.md works.
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
scripts/                                    Empty (Phase 2 will add import-historical.ts)
```

`CLAUDE.md` at repo root has the durable session learnings — read it before assuming anything about why a thing is the way it is. Every gotcha I hit during Phase 1 is recorded there.

## How to pick up

1. **If picking up Phase 1F (email rework):** brainstorm → spec → plan → implement. Tight scope, can use the `/frontend-design:frontend-design` skill since it's a single visual file.
2. **If picking up Phase 2 (historical import):** check legacy CSV URLs in old `CLAUDE.md` content (pre-rebuild commits on `legacy-static`). Write the script as a one-off in `scripts/import-historical.ts`. Idempotent dedup by phone+edition.
3. **If picking up Phase 3 (admin):** start with the dashboard screen + editions CRUD. Copy bgc admin patterns liberally. Worker has the `/api/admin/*` route shape ready — see `worker/src/index.ts`'s gated admin if/else chain (currently empty).
4. **If just opening registration for REPLAY 3:** the SQL flip + deploy-hook recipe at top of this doc.

The next session can read `CLAUDE.md` + this file + the master spec at `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md` and be fully oriented in ~10 minutes.
