# AGENTS.md — replay-website

Operational guidance for agents working in this repository. Keep it current.
See the "Appending learnings" section below: durable, non-obvious discoveries
belong there, while ephemeral task status and secrets do not.

## Current source of truth

- `src/` is the Astro 7 public site, deployed to Cloudflare Pages from `main`.
- `app/` is the Vite/React attendee PWA for `app.replaycon.in`. Its public
  schedule, device-local agenda, venue shell, and runtime announcements are
  implemented; secure tickets, maps, check-in, and library circulation remain
  gated by `docs/ATTENDEE_APP_PLAN.md`.
- `admin/` is the Vite/React operations console, deployed as a separate
  Cloudflare Pages project and protected by Cloudflare Access.
- `worker/` is the Cloudflare Worker API for registration, capacity, discounts,
  email dispatch, calendar files, and the admin API. A Git push does not deploy
  Worker code; deploy it deliberately with Wrangler after verification.
- `supabase/` contains append-only Postgres migrations and seeds. Check the
  linked migration state before applying new migrations.
- `apps-script/` is the source for the signed registration-email relay. Its URL
  and signing secret belong only in Apps Script/Cloudflare secret storage.
- `README.md` documents local setup, verification, current behavior, and the
  deployment/secret boundary.
- `docs/LIVE_EVENT_READINESS.md` is the deliberately deferred launch checklist.

Run the root and attendee-app tests/builds, the admin tests/build, and the Worker
tests/typecheck before publishing. Run `npm audit` separately in all three
dependency trees (the attendee app shares the root tree). Never
commit `.env*`, deploy-hook URLs, Apps Script deployment URLs, service keys,
signing secrets, source data, or audit exports containing personal data.

## Historical snapshot (superseded)

The material below describes the original 2025 static site and is retained only
as historical context. It must not override the current source-of-truth section,
README, application code, migrations, or newer dated session learnings.

## What this is

Static marketing + registration site for **REPLAY**, a Bangalore board-game convention (event April 18–19, 2025). Served at **replaycon.in** via GitHub Pages. Vanilla HTML/CSS/JS — **no framework, no build tools, no package.json**. Repo: `boredsid/replay-website`.

## File map

| File | Purpose |
|---|---|
| `index.html` | Landing: hero carousel, sponsors, about, `#schedule` (Sat/Sun tabs), `#tickets` |
| `register.html` | Registration form + UPI payment bottom sheet + Guild Path discounts + capacity gating |
| `preorder.html` | Pre-order store (board games + jigsaw puzzles) + cart + checkout + UPI payment |
| `email-confirmation.html` | Registration confirmation email template (fetched live from GitHub raw by Apps Script) |
| `preorder-confirmation-email.html` | Pre-order confirmation email template (same pattern) |
| `apps-script-preorder.js` | **Not deployed from repo.** Snippet to paste/merge into the existing Google Apps Script project |
| `.github/workflows/deploy.yml` | GitHub Pages deploy + secret injection (`__SHEET_URL__`) |
| `CNAME` | `replaycon.in` |
| `carousel-photos/`, `sponsor-logos/`, `payment-app-icons/`, `replay-logo.png` | Static assets |
| `.claude/settings.local.json` | Local Claude permissions (don't depend on paths in here — legacy `/Documents/REPLAY website` refs) |

All inline CSS and JS. Each HTML file is a self-contained page.

## Deploy

- Pushing to `main` triggers `.github/workflows/deploy.yml` → publishes to GitHub Pages.
- **Secret injection**: the workflow runs a Python step that replaces the literal string `__SHEET_URL__` inside `register.html` and `preorder.html` with the `SHEET_URL` repo secret (the Apps Script web-app endpoint). **Never hardcode the real URL or commit it.** The placeholder is what lives in git.
- Python (not `sed`) is used because the URL contains `&` which breaks `sed` replacement — see commit `74b831b`. Do not regress to `sed`.
- No local preview server is set up in this repo. Opening HTML files directly works for layout/CSS work, but anything touching `SHEET_URL` won't resolve locally (the literal `__SHEET_URL__` is what's present). For live data testing, push to a branch or test against a staging Apps Script URL.

## Backend: Google Apps Script + Sheets

There is **no server** beyond Google Apps Script (GAS). The GAS project lives in Google — it's **not in this repo**. `apps-script-preorder.js` is a reference snippet to merge into the existing GAS project; it is never executed from this repo.

Data flow:
- **GET (reads)** — pages load data via **JSONP** (dynamically injected `<script>` tag calling `SHEET_URL + '?action=...&callback=...'`). JSONP is deliberate — the `fetch` approach hit CORS; see commit `c5066b4`. Do not "fix" this to use `fetch` + CORS.
  - `action=getData` → returns `{ guild, registrations }` for `register.html` (guild membership list + existing registrations for capacity + fraud checks)
  - `action=getPreorderData` → returns `{ puzzles, games, registrations }` for `preorder.html` (product catalog + phone gating)
- **POST (writes)** — pages send `fetch(SHEET_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) })`.
  - **`mode: 'no-cors'` means the response is opaque** — the client can't read success/failure. Both `.then` and `.catch` branches always call `showSuccess()`. Don't try to read the response; it won't work.
  - Registration POSTs have no `action` field → GAS `doPost` appends to the active sheet.
  - Pre-order POSTs include `action: 'preorder'` → GAS appends to a separate `Orders` tab.
- **Confirmation emails** are sent by GAS via `GmailApp.sendEmail`. The templates are fetched live via `UrlFetchApp.fetch('https://raw.githubusercontent.com/boredsid/replay-website/main/...email.html')`. **Template changes only take effect after merging to `main`.** Placeholders: `{{name}}`, `{{phone}}`, `{{passType}}`, `{{day}}`, `{{quantity}}` (registration); `{{name}}`, `{{phone}}`, `{{items}}`, `{{total}}` (pre-order).

## Data sources (published CSV URLs, hardcoded in Apps Script)

- Guild members CSV — published sheet (gid 581649392). Columns: `Name`, `Phone Number`, `Plan`, `Current State` (only `Active` counted).
- Registrations CSV — published sheet (gid 0). Columns: `Phone`, `Quantity`, `Pass Type`, `Day`.
- Products sheet — puzzles on gid 0, games on gid 22445468. Columns include `Name`, `Publisher`, `MRP including GST`, `Reselling price`, `Description`, `Image 1..3`, and category-specific fields (`Piece Count`/`Shape`/`Size`/`Designer` for puzzles; `Player Count`/`Play Time` for games). Rows with no `Name` or no `Reselling price` are skipped.

## Guild Path discount logic (`register.html`)

Lives in the inline `<script>` around lines 850–1100. Three tiers:

| Plan | Rate (oneshot & campaign) | Cap |
|---|---|---|
| Initiate | 20% off | none |
| Adventurer | 100% off | **₹1,000 max discount** |
| Guildmaster | 100% off | none |

- Phones are normalized to the **last 10 digits** (`normalizePhone`) before any lookup.
- **Fraud prevention**: if the phone already exists in the registrations sheet, the discount is **blocked** (`discountBlocked = true`). This prevents a Guild member buying one day-pass at 100% off then coming back for the second day. If you ever split the fraud check, preserve this intent.
- If `final === 0` after discount, the payment sheet is **bypassed** — `submitDirectly()` posts to Sheets and shows the success page. The UPI flow only runs for non-zero totals.

## Capacity gating (`register.html`)

- `CAPACITY_SAT = 60`, `CAPACITY_SUN = 58`. Counts are computed from the registrations CSV: a 2-day pass adds to both days.
- A row only counts toward capacity if its `Payment Status` (column J) is a non-empty value other than `Cancelled` or `Pending`. The Guild Path fraud check (`existingRegs`) still uses every registered phone regardless of status — split intentionally so a Cancelled/Pending row frees a seat but doesn't let the same member grab a second free day.
- `updateAvailability()` greys out the Campaign pass radio if **either** Sat or Sun is full (because a 2-day pass needs both). Oneshot is only fully disabled when **both** days are sold out; individual day radios are disabled per-day.
- Changing these rules also means touching the disabled-state CSS `.sold-out` class.

## Pre-order checkout (`preorder.html`)

- **Pass holders only**: `checkRegistration()` matches `coPhone` against `existingRegs` loaded via `getPreorderData`. The Buy button stays disabled until `isRegistered === true`, the cart has items, and the form is valid. Don't remove this gate casually — it's the whole access model for the store.
- Cart is an in-memory JS object (no localStorage); refreshing the page wipes it.
- Same UPI flow as registration, same hardcoded UPI: `suranjanadatta24-1@okaxis` / `REPLAY Convention`. QR code is generated at checkout time via `https://api.qrserver.com/v1/create-qr-code/`.

## CSV parser nuance

`register.html` uses a simple line-based CSV parser (`parseCSV` / `parseCSVLine`) that splits on `\n` first — **this is broken for multi-line quoted fields** but fine for the registration data which has no newlines inside cells. The fixed multi-line-safe parser (`parseCsvRows`) lives in `apps-script-preorder.js` and is used server-side because product descriptions contain newlines. If you ever load product CSVs directly from client JS, use the server-side parser approach — don't reuse `parseCSVLine`.

## Editing guidance

- **Don't introduce build tooling, npm, bundlers, or frameworks** unless asked. The whole point is zero-build, zero-deps.
- Each page is a long single file with inline `<style>` and `<script>`. When editing, keep CSS in the `<style>` block at the top and JS at the bottom — don't extract into separate files unless asked.
- CSS custom properties for the palette live in `:root` in `index.html` and are re-declared in the other pages. If you change a brand color, update all of them.
- Fonts: `Alexandria` (body/UI) + `Amatic SC` (display). Loaded from Google Fonts in each HTML head.
- Event dates, prices, capacity, UPI ID, and Guild tier rules are **all hardcoded per-page** — updates must be done in every relevant page.

## Gotchas cheat-sheet

1. `SHEET_URL` is literally `'__SHEET_URL__'` in the source — don't "fix" it and don't commit the real URL.
2. `fetch(..., { mode: 'no-cors' })` returns an opaque response; POST success is always assumed.
3. Data reads use **JSONP** deliberately — don't convert to `fetch`.
4. Email template edits require merging to `main` before GAS picks them up (it fetches from `raw.githubusercontent.com/.../main/...`).
5. Guild discount is blocked if phone already registered — this is the anti-split-abuse guard.
6. `apps-script-preorder.js` is not code the repo runs; it's documentation/paste-bait for the GAS project.
7. Deploy uses Python for secret replacement — don't switch to `sed` (ampersand in URL breaks it).
8. Today's date may be past the event (April 18–19, 2025). The site still exists but registration/preorder flows are historical — confirm intent before making "live" changes.

## Quick commands

```bash
# Preview locally (layout only; SHEET_URL won't resolve)
open /Users/siddhantnarula/Projects/replay-website/index.html

# Watch the latest deploy
gh run list --limit 5
gh run watch
```

---

## Appending learnings (instructions for future Claude sessions)

**Whenever you — any Claude agent working in this repo — learn something durable and non-obvious about this codebase, append it to the "Session learnings" list below.** This includes:

- Bugs you fixed where the root cause is subtle and likely to recur
- Constraints or invariants you discovered (e.g., "column X in the sheet must be a number, not a string")
- External system quirks (Apps Script, GAS deploy, GitHub Pages, Gmail, QR API) that tripped you up
- User preferences stated in-session that apply to future work on this repo
- Deprecations, schema changes, or new moving parts

**Rules for entries:**

1. Append, never rewrite — preserve history.
2. Format: `- YYYY-MM-DD — one-line fact. **Why it matters:** one line.`
3. Keep it one or two lines per entry. If it needs more, update the relevant section above instead and cross-reference.
4. If an entry in the main sections above becomes wrong, fix it in place AND leave a learning entry noting the correction.
5. Do **not** log session-specific task status, PR numbers, or ephemeral debugging notes. Only durable facts.
6. Before adding, skim existing entries — don't duplicate.

### Session learnings

<!-- Append entries below this line. Oldest first. -->
- 2026-04-15 — Registrations sheet has a duplicate `Phone` column (side-table for manual WhatsAround/Swiggy entries, far right of the sheet). **Why it matters:** GAS `parseCsv` must keep the first occurrence of a duplicate header; otherwise `row['Phone']` returns the mostly-empty side-table column and every registered user looks unregistered to the pre-order gate and the register.html fraud check.
- 2026-04-17 — Column J `Payment Status` added to the registrations sheet; capacity count in `register.html` now excludes rows where status is `Cancelled`, `Pending`, or empty. **Why it matters:** GAS `doGet` for `action=getData` must emit `paymentStatus` on each registration object — if it's missing, every row looks empty and is excluded, making the sold-out gate never trigger. The fraud-check (`existingRegs`) deliberately ignores status to keep the anti-split guard intact.
- 2026-05-20 — Phase 0 of the rebuild is live alongside the legacy site. New tree (Astro + worker + admin + Supabase) lives on branch `rebuild/phase-0`; legacy static site keeps serving the apex from `main` until Phase 1 cutover. Live infra: replay Supabase project `qvkynwlmzeybdiapbcsy`, worker at `api.replaycon.in`, site preview at `replay-website.pages.dev` (Pages branch = `rebuild/phase-0`), admin at `admin.replaycon.in` (CF Access gated via the shared `boardgamecompany` Zero Trust team, replay-specific AUD). **Why it matters:** edits to `main` still ship the legacy site; edits to `rebuild/phase-0` ship the new site preview. Don't bind apex DNS to the new Pages project until Phase 1 explicitly cuts over.
- 2026-05-20 — Guild Path lookups for replay go through bgc's worker at `POST https://api.boardgamecompany.in/api/guild-status` (bearer-token auth via shared `REPLAY_TO_BGC_SECRET`). Response shape `{tier, active}` is a fixed contract — bgc's `guild_path_members` schema (`user_id` FK, `status='paid'`, `expires_at >=` today) can evolve as long as the response shape stays. **Why it matters:** if bgc renames columns, only `bgc-website/worker/src/guild-status.ts` needs to change; replay never reads bgc's tables directly.
- 2026-05-20 — `worker/src/apps-script.ts` sends the HMAC signature both as an `X-Signature` header AND as a `?X-Signature=` query param because Apps Script `doPost` cannot read custom request headers reliably. **Why it matters:** if you "clean up" the duplicate and only send the header, every webhook call will fail signature verification silently in the GAS project.
- 2026-05-20 — Cloudflare Worker `[[routes]]` with `custom_domain = true` does not allow wildcards or paths. Use bare hostname (`pattern = "api.replaycon.in"`), not `"api.replaycon.in/*"`. **Why it matters:** plan drafts and old bgc-style `routes` examples sometimes show wildcards; copying them straight into a custom_domain route fails deploy.
- 2026-05-20 — `wrangler secret put` against a not-yet-deployed worker name auto-creates an empty worker shell with that name. **Why it matters:** secrets can be loaded before the first `wrangler deploy`; the first deploy then attaches code to the pre-existing shell with secrets intact.
- 2026-05-20 — bgc admin uses Vite + React + shadcn; replay admin mirrors that stack. **Why it matters:** when creating Cloudflare Pages projects for replay admin, pick **Vite** as framework preset (not React) so the Node 22 build env + correct defaults apply.
- 2026-05-22 — Phase 1B shipped 3 site pages (/, /register, /schedule) + 3 React islands (RegisterForm, NotifyMeForm, LiveSpotsBadge). Edition `is_published=true` for replay-3; the site rebuilds through the admin's protected rebuild action after Supabase edits. **Why it matters:** flipping `registration_status` or `is_published` requires a rebuild (~45-60s). The raw deploy-hook URL is a secret and must never be written into source or documentation.
- 2026-05-22 — `@astrojs/mdx` integration is **mandatory** for Content Collections to find .mdx files. Astro 6 silently logs "The collection X does not exist or is empty" but completes the build with empty content (so Hero/About sections render only their fallback text). **Why it matters:** if Hero/About copy disappears, check `astro.config.mjs` for `mdx()` in `integrations`, not the content files themselves.
- 2026-05-22 — Astro 6 `getEntry('collection', 'id')` is unreliable with the glob loader pattern; `getCollection('collection').find((e) => e.id === '…')` is robust regardless of how IDs are derived from filenames. **Why it matters:** changing to a different loader pattern in the future shouldn't silently break getEntry-based components.
- 2026-05-22 (superseded 2026-08-16) — The old Astro 6 / Vite 7 pin is no longer current. The root site now uses Astro 7 and Vitest 4; keep the lockfile, run the complete site build and tests after dependency changes, and rely on `npm audit` rather than reviving the old pin.
- 2026-05-22 — Local builds need `.env.local` with `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`/`PUBLIC_WORKER_URL`/`PUBLIC_UPI_ID` set, or the build pauses 30-50s per page on `placeholder.supabase.co` ConnectTimeoutError. **Why it matters:** the file is `.gitignored` and not in any committed config; new contributors need to ask for the values or copy from Cloudflare Pages env.
- 2026-05-22 — RegisterForm uses two debounce timers: 300ms on phone field for `/api/lookup-phone`, 1s on name/email blur for `/api/lead`. **Why it matters:** if a Vitest `waitFor` test seems to hang, default 5s timeout is enough — don't bump unless actually needed. Component tests rely on `userEvent.setup()` driving real timing.
- 2026-05-22 — Phase 1C shipped: design overhaul. REPLAY palette in Tailwind 4 `@theme` (orange anchor, teal/yellow/violet accents on cream). Brutalist utility classes (`.btn`, `.card-brutal`, `.pill`, `.input-brutal`, `.card-flat`, `.label-brutal`) ported from bgc with palette swap (`.btn-secondary` hover = teal, not bgc's pink). Hero is split text/photo; photo path in `landing/hero.mdx` frontmatter (`photo` field). `carousel-photos/` moved into `public/` so Astro serves them at `/carousel-photos/*`. **Why it matters:** reach for utility classes in `global.css` first; if you need a new variant, add it there so it's reusable across Astro + JSX. Don't inline brutalism with one-off Tailwind chains.
- 2026-05-22 — Schedule kind pills: workshop→teal, tournament→orange, open-play→yellow, meal→cream, talk→violet. Map lives in `ScheduleDay.astro`. **Why it matters:** adding a new `schedule_items.kind` value requires updating both the DB check constraint (migration) AND the pill-color map.
- 2026-05-22 — Email template uses a system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...`) instead of Inter/Space Grotesk. **Why it matters:** Gmail / Outlook reliably ignore web fonts. System stack ensures consistent rendering. Don't try to "fix" this by adding Google Fonts to the email.
- 2026-05-22 — RegisterForm pass-type & day selectors wrap a `<input type="radio" class="sr-only">` inside a styled `<label class="btn ...">` (or `.pill`). **Why it matters:** Testing Library's `getByLabelText` still finds the radio input through the label association, and `.toBeDisabled()` works on the input — no test selector changes needed. If you replace the pattern, re-verify the 5 RegisterForm tests.
- 2026-05-22 — Phase 1E: bgc-aligned visual redesign shipped to apex via PR #4 squash-merge (commit `f31823b`). Palette swapped to bgc's (orange + pink + blue + green + purple + yellow on cream `#FFF8E7`). Hero/Guild slabs use indigo `#1A0088`. Logo wrapped in indigo brutalist frame in nav. 4 new shared components: HeroPhotoBand, EditorialStripe, DarkBand, SponsorsBand. LiveSpotsBadge uses bgc-style progress bars. Edition naming: `editions.name` is just "REPLAY" (not "REPLAY 3"); edition number derived from slug via `editionOrdinal()` ("3rd edition"). **Why it matters:** when adding a new section, reach for the shared components first; if you need a dark slab, use `<DarkBand>` not a one-off `<section style="background: #1A0088">`. The single dark color (`#1A0088`) is part of the brand now — don't bleed pure black into dark slabs.
- 2026-05-22 — Phase 1D cutover shipped: apex `replaycon.in` and `www.replaycon.in` now served by Cloudflare Pages from `main`, not GitHub Pages. Legacy `*.html`, `CNAME`, `.github/workflows/deploy.yml`, `apps-script-preorder.js` removed from `main` (still in `legacy-static` branch). **Why it matters:** the apex is no longer reachable through GitHub Pages — re-enabling it requires re-adding the 4 A + 4 AAAA records + a CNAME, plus enabling GH Pages in repo Settings. Full rollback recipe is in `docs/superpowers/specs/2026-05-22-replay-phase-1d-cutover-design.md`.
- 2026-05-22 — Replay Apps Script `Code.gs` template URL points at `main` post-cutover (was `rebuild/phase-0` during 1A-1C). **Why it matters:** future edits to `src/emails/registration.html` must land on `main` (via PR) for GAS to pick them up. Direct edits on a branch only show up after merging.
- 2026-05-22 — Cloudflare Pages without a `404.html` in `dist/` falls back to serving `index.html` content for any unmatched route, returning a 200 status. **Why it matters:** for real 404 behaviour, add `src/pages/404.astro` (Astro builds it to `dist/404.html`, Pages picks it up automatically). Without it, `/register.html` post-cutover returned the landing page HTML at 200, not a real 404.
- 2026-05-22 — Static assets referenced by absolute path in components (`/link-preview.png`, `/replay-logo.png`) must live under `public/`, not the repo root. **Why it matters:** legacy GitHub Pages served whatever was at repo root; Astro only serves files copied from `public/` into `dist/`. Asset paths look identical in HTML but break post-build if the file is at root.
- 2026-05-22 — Astro defaults to trailing-slash routes (`/register` → 308 → `/register/`). **Why it matters:** that 308 is normal and browsers handle it transparently — don't "fix" it by adding `trailingSlash: 'never'` to `astro.config.mjs` unless you have a specific SEO reason to flatten it. The 308 + final 200 chain is correct behaviour.
- 2026-05-24 — Phase 1F shipped: registration email reskinned to 1E visual identity (single brutalist card on cream, 4px ink + 8px shadow, yellow/green/violet/ink blocks). Five new template placeholders (`{{calendar_google_url}}`, `{{calendar_ics_url}}`, `{{schedule_url}}`, `{{instagram_url}}`, `{{whatsapp_share_url}}`) and one new `{{date_range}}` placeholder (replaces `{{start_date}}` + `{{end_date}}`). Worker now ports `editionOrdinal` / `shortDate` / `shortDateRange` / `capitalize` from `src/lib/data.ts` into `worker/src/format.ts` so emails render "REPLAY 3rd edition" / "Sep 12 – Sep 13" / "Guildmaster". New worker route `GET /api/ics/:slug.ics` returns iCalendar for any published edition (90 worker tests). **Why it matters:** any future "make the worker display X" decision should reuse helpers in `worker/src/format.ts`, not re-implement; if you add another helper to `src/lib/data.ts`, port it across so the worker stays consistent. Deploy ordering still applies: worker first, then template push, otherwise `{{calendar_ics_url}}` 404s in emails sent during the gap.
- 2026-05-24 (superseded 2026-08-16) — Edition hours live in `editions.daily_start_time` / `daily_end_time`; `worker/src/calendar.ts` converts those IST values for Google Calendar and ICS. **Why it matters:** update hours through the edition admin, never by reintroducing hard-coded UTC constants.
- 2026-05-31 — Phase 2 historical import shipped: `scripts/import-historical.ts` (`npm run import:historical [-- --dry-run]`, tsx) loads replay-1/replay-2 registrations + replay-2 orders from **gitignored** `scripts/data/*.csv` into Supabase, using `scripts/lib/csv.ts` + `scripts/lib/mappers.ts` (pure, 35 unit tests). Editions seeded via `supabase/seeds/replay-1-2.sql`. Idempotent via per-edition delete-then-reinsert, deletes scoped to the `['replay-1','replay-2']` slug allowlist so replay-3 is never touched; users upserted by phone. **Why it matters:** `registrations.seats` is qty (passes), NOT the legacy `Seats used` seat-days column — capacity is derived by expanding over `days[]` in `getConfirmedSeatsByDay`, so map `seats` from `Quantity`/`Seats`, never `Seats used`, or campaign passes double-count. Historical `discount_applied` is a cause-agnostic gross (`base − paid`); guild-vs-credit split isn't recoverable from the source CSVs. Run order: apply the seed before the import (script aborts if the slugs aren't found).
- 2026-05-31 — replay-2 had 21 walk-in registrations with blank phone/email but real names. Per organiser decision each imports as its OWN user with a sequential synthetic phone `0000000000`, `0000000001`, … (`users.name` = the walk-in's name), not collapsed onto one shared row. Two-step rule in `scripts/lib/mappers.ts`: (a) a row whose phone fails `sanitizePhone` first gets a placeholder phone + `source.guest_name`; (b) `assignWalkinPhones(pairs, start)` then walks all walk-in pairs in file/row order and assigns each the next `String(seq).padStart(10,'0')` phone + a user named after `guest_name`. The orchestrator chains the counter across replay-1 → replay-2 regs → orders so numbering is stable + gap-free across re-runs. `source.guest_name` is kept as the placeholder marker. **Why it matters:** (1) each walk-in is now a distinct user, so unique-attendee counts by phone are correct again (142 users = 121 real + 21 synthetic). (2) Deviates from the original spec (which said skip bad-phone rows). (3) Re-running the import reproduces the same synthetic phones deterministically (idempotent) — but it can't recover real phone numbers; correcting those means updating each synthetic user's phone, keyed by name / the `0000000xxx` range (see HANDOFF "Correct replay-2 walk-in placeholder phones").
- 2026-06-02 — Phase 3A admin shipped: worker `/api/admin/*` route group gated in `worker/src/index.ts` by `verifyAccessJwt` reading the CF-injected `Cf-Access-Jwt-Assertion` header; handlers in `worker/src/admin/` (whoami, rebuild, dashboard, registrations list/get/create/patch, leads, audit). SPA in `admin/` (Vite+React+shadcn, single admin role — no guest), port-and-adapt of `bgc-website/admin`. **Auth transport is SAME-ORIGIN, not cross-origin:** the SPA calls RELATIVE `/api/admin/*` on its own host `admin.replaycon.in`, served by the worker via a Workers route `admin.replaycon.in/api/admin/*` (`zone_name = "replaycon.in"`) that takes precedence over the Pages project for that path prefix; `admin/src/lib/api.ts` forces an empty API base when `location.hostname === 'admin.replaycon.in'`. **Why same-origin (this is the key gotcha):** the original cross-origin design (SPA → `api.replaycon.in/api/admin`) was blocked by Cloudflare Access returning **403 to every CORS preflight** — browser `OPTIONS` preflights carry no cookie, so Access rejects them, and configuring the Access app's own CORS settings did NOT fix it in practice (tried, still 403). Same-origin eliminates CORS/preflight entirely. `admin.replaycon.in` is wholly behind the CF Access app (AUD `0983cd2a…132f` = worker `[vars] CF_ACCESS_AUD`), so CF injects the JWT on `/api/admin/*` there too. The worker still emits credentialed CORS via `adminJson` (harmless same-origin; also still covers the `api.replaycon.in/api/admin` path, which exists + is Access-gated but is UNUSED by the SPA). Public api paths (`/api/health`, `/api/register`, `/api/lead`, `/api/ics/*`) stay OUTSIDE Access. Don't "restore" cross-origin calls to api.replaycon.in for admin — it reintroduces the preflight 403.
- 2026-06-02 (updated 2026-08-16) — The `admin/` SPA has its own Vite 8 + React 19 + Tailwind 4 + Vitest 4 toolchain. `BrowserRouter` + `StrictMode` live in `admin/src/main.tsx`; `App.tsx` must not add a second Router. Test and audit the admin from `admin/` because its lockfile and deployment are independent from the root site.
- 2026-06-02 — Admin `leads` screen shows `step_reached` (not email): the `leads` table has NO email column (`worker/src/lead.ts` writes `edition_id, phone, step_reached, name` only). **Why it matters:** don't add an Email column to the leads UI/`LeadRow` type — it'll always be blank. Manual-add registration (`ManualRegistrationDrawer`) currently sends no `edition`, so the worker defaults to the current edition — fine while replay-3 is current, but add an explicit edition selector in Phase 3B before a second edition goes current.
- 2026-06-02 — The `admin/` SPA is built by Cloudflare Pages with **root dir = `admin/`**, so Pages runs `npm ci` against `admin/package.json` ONLY (no repo-root `node_modules` to fall back on). The prod build is `tsc -b && vite build`, and `tsc -b` typechecks `*.test.tsx`, so EVERY package imported by code OR tests under `admin/` must be in `admin/package.json` — a missing test-only dep (`@testing-library/user-event`) failed the Pages build even though it resolved locally by walking up to the repo-root `node_modules`. **Why it matters:** a green local `npm run build` run from `admin/` does NOT prove the Pages build passes; when you add any import under `admin/`, add the dep to `admin/package.json` (not just the repo root). bgc admin doesn't use `user-event`, so it wasn't in the mirrored deps.
- 2026-06-02 — Registrations do NOT require a site rebuild: the public site reads live spot counts + capacity at runtime via the `LiveSpotsBadge`/register islands hitting `GET /api/edition-spots/:id`, and admin manual-add does not fire the deploy hook. **Why it matters:** the "Rebuild site" button (and `POST /api/admin/rebuild`) is only for build-time-baked changes — `registration_status`/`is_published` flips, edition details (dates/venue/pricing/name), schedule, sponsors, hero/about MDX. Don't wire routine registration writes to the deploy hook.
- 2026-06-07 (superseded 2026-08-16) — Current-edition selection is explicit again: both the public build and Worker require `is_current=true` and `is_published=true`, and a database trigger clears the previous current flag when a new one is selected. **Why it matters:** the admin's “Current edition” control is authoritative; do not fall back to whichever published edition has the latest date.
- 2026-06-07 — Migration 003 also (a) recreated `registrations_user_phone_fkey` + `orders_user_phone_fkey` with `on update cascade` so editing `users.phone` cascades (powers the Users "Change phone number" action — used to fix the 21 replay-2 walk-in placeholder phones), and (b) **widened `admin_audit_log.target_id` from `uuid` → `text`**. The widening was REQUIRED: user audits write the 10-digit phone as `target_id`, and `writeAudit` only `console.error`s on failure, so before the widening every `user.update`/`user.phone_change` audit insert silently failed the uuid type check and never persisted. **Why it matters:** any future admin audit whose target isn't a uuid (phone, slug, etc.) now works; don't narrow `target_id` back to uuid. The phone→UUID identity migration (HANDOFF tech-debt) would supersede the FK cascade workaround.
- 2026-06-08 (updated 2026-08-16) — Historical closed editions stay editable with their original length, including one-day replay-1. Any upcoming/open/sold-out edition must span exactly two consecutive days and have exactly day1/day2 prices and capacity plus a campaign price. **Why it matters:** this matches the public registration and schedule contract without corrupting historical data.
- 2026-06-08 — Admin uses in-app shadcn `Dialog` modals (not native `confirm()`/`prompt()`) for the EditionDrawer "Rebuild the site?" prompt and the UserDrawer change-phone flow — the admin is a mobile PWA, so native browser dialogs are out. **Why it matters:** when adding confirm/input prompts to admin, reach for `@/components/ui/dialog`, not `window.confirm`/`prompt`.
- 2026-06-08 — Cloudflare Pages deploy hooks are branch-bound. After a branch rename or cutover, verify the hook's branch in the dashboard. Treat the full hook URL as a credential: keep it only in the Worker secret `CLOUDFLARE_PAGES_DEPLOY_HOOK`, rotate it if exposed, and never record its ID or URL in the repository.
- 2026-08-19 — The readiness public-site IA is Home, Schedule, Tickets, Plan Your Visit, Contact Us, and Get Involved; `/tickets` is canonical and `/register` redirects there. **Why it matters:** keep navigation, structured data, email links, and future public CTAs on `/tickets`; do not revive a separate Register page.
- 2026-08-21 — Plan Your Visit content is edition data managed in the Edition drawer: address/map, entrance/check-in, Metro/bus, parking, food/water, library process, and same-day help. **Why it matters:** apply the visit-details migration before deploying the Worker/admin, then rebuild the static public site after staff updates these fields.
- 2026-08-19 — The event-day app launch scope includes offline public schedule/map/info, secure personal ticket/QR/check-in/announcements, and audited game-library borrowing; moderation-heavy social features are a follow-up. **Why it matters:** admin check-in, announcements, venue-map, and library circulation are dependencies for the future app, not public-site workarounds.
- 2026-08-20 — REPLAY 3 has one ticket price set (₹700 either day, ₹1,200 both days); partner prices exclude GST, and the approved booth/community-engagement packages live on Get Involved. **Why it matters:** do not reintroduce an early-bird phase or silently alter the 15%-discount booth condition, complimentary-pass counts, seven-day cancellation deadline, or included table/power terms.
- 2026-08-20 — Public programme items use `schedule_items.section` plus all-day/timed, host, sign-up, display-order, and draft/published/cancelled fields; internal space allocation and staff responsibility stay out of the public/admin programme contract. **Why it matters:** keep the public Schedule and admin Programme editor aligned whenever kinds or sections change, and rebuild the static site after publishing programme edits.
- 2026-08-20 — Fontsource variable packages register `Space Grotesk Variable` and `Inter Variable`, not the non-variable Google Fonts family names used by BGC. **Why it matters:** REPLAY's `--font-heading` and `--font-body` tokens must name the variable families first or browsers silently fall back even though the font files are bundled.
- 2026-08-20 — Root `sponsor-logos/` is the canonical homepage partner/sponsor source and is discovered automatically at build time; filenames become accessible labels. **Why it matters:** add or remove supported image files in that folder instead of maintaining a code list or edition sponsor rows, then rebuild/deploy the static site; the logo wall contains mixed source sizes/backgrounds without changing aspect ratios.
- 2026-08-20 — Edition pricing stores one-day price as scalar `pricing.oneshot` and the two-day price as `pricing.campaign`; capacity remains keyed by day. **Why it matters:** this supersedes the 2026-06-08 per-day-pricing shape—admin, public ticket display, and registration calculations must never recreate day-specific prices or allow Saturday/Sunday price drift.
- 2026-08-21 — Paid public registrations use a read-only `/api/register/preview`; only “I've paid” calls `/api/register` and persists the preview reference as a pending registration ID. **Why it matters:** closing or abandoning UPI must not reserve capacity or block a Guild Path discount; deploy the Worker before the public Pages build because the new client requires the preview endpoint.
- 2026-08-21 — Public ticket bookings allow 1–10 tickets per registration; `registrations.seats` stores that quantity, while a Guild Path benefit applies only to the member's first eligible ticket. **Why it matters:** subtotal and capacity checks must multiply by quantity, but the personal membership discount must not multiply across guest tickets.
- 2026-08-21 — Organiser announcements are private database rows exposed only as an active, public-safe projection through `/api/app/bootstrap`; the incident banner belongs in the attendee app, not the public website. **Why it matters:** keep browser roles off the table, preserve the admin audit trail, and deploy the Worker before app UI changes that depend on the payload.
- 2026-08-21 — Attendee-app event date/time formatting must use the event timezone (`Asia/Kolkata`) instead of the device timezone for calendar dates and schedule state. **Why it matters:** organisers and attendees abroad must not see a different event day or premature “live” state.
- 2026-08-21 — Booth and community-engagement pricing is edition data in `editions.partner_pricing`; public/admin writes go through the Worker into the private `partners` table, separate from the build-time `sponsor-logos/` source. **Why it matters:** preserve the Worker-calculated GST/payment snapshot and RLS boundary, and do not treat operational partner purchases as homepage-logo records.
- 2026-08-21 — Paid partner checkout mirrors registration's preview-then-record flow: `/api/partner-purchase/preview` is read-only, and only “I've paid” persists the supplied payment reference as a pending partner. **Why it matters:** closing or abandoning UPI must not create false partner bookings; deploy the Worker before the public Pages build.
