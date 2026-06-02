# CLAUDE.md — replay-website

Context for Claude Code working in this repo. Keep it current. See the "Appending learnings" section at the bottom — any durable, non-obvious learning from a session must be appended here.

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
- 2026-05-22 — Phase 1B shipped 3 site pages (/, /register, /schedule) + 3 React islands (RegisterForm, NotifyMeForm, LiveSpotsBadge). Edition `is_published=true` for replay-3; site rebuilds via CF Pages deploy hook (`01e9488c-00cc-4c38-aa87-9be5820a51f7`) after Supabase edits. **Why it matters:** flipping `registration_status` or `is_published` requires firing the deploy hook to refresh the static site (~45-60s rebuild). The hook is also wired into the worker as `CLOUDFLARE_PAGES_DEPLOY_HOOK` for Phase 3 admin actions.
- 2026-05-22 — `@astrojs/mdx` integration is **mandatory** for Content Collections to find .mdx files. Astro 6 silently logs "The collection X does not exist or is empty" but completes the build with empty content (so Hero/About sections render only their fallback text). **Why it matters:** if Hero/About copy disappears, check `astro.config.mjs` for `mdx()` in `integrations`, not the content files themselves.
- 2026-05-22 — Astro 6 `getEntry('collection', 'id')` is unreliable with the glob loader pattern; `getCollection('collection').find((e) => e.id === '…')` is robust regardless of how IDs are derived from filenames. **Why it matters:** changing to a different loader pattern in the future shouldn't silently break getEntry-based components.
- 2026-05-22 — Pin Vite-chain dev deps to vite-7-compatible versions: `vitest@^3`, `@vitejs/plugin-react@^5`, `@tailwindcss/vite@4.2`, `tailwindcss@4.2`. Astro 6.3.3 internally uses vite 7. `npm install --save-dev pkg@latest` will pull vite 8 into `@tailwindcss/vite@4.3`, which calls into a vite-8-only binding API and crashes the build with "Missing field tsconfigPaths". **Why it matters:** any future `npm install` of dev deps must explicitly pin to vite-7-compatible versions until Astro releases a vite-8 line.
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
- 2026-05-24 — `worker/src/calendar.ts` exports `toUtcBasic(dateIso, 'start'|'end')` as the single source of "10:00–19:00 IST → UTC" conversion used by both Google Calendar URL and ICS endpoint. **Why it matters:** if convention hours ever change (e.g. extends to 21:00), change the `'043000Z'` / `'133000Z'` constants in one place. Don't reintroduce per-file copies — the duplication was caught and removed in this phase.
- 2026-05-31 — Phase 2 historical import shipped: `scripts/import-historical.ts` (`npm run import:historical [-- --dry-run]`, tsx) loads replay-1/replay-2 registrations + replay-2 orders from **gitignored** `scripts/data/*.csv` into Supabase, using `scripts/lib/csv.ts` + `scripts/lib/mappers.ts` (pure, 35 unit tests). Editions seeded via `supabase/seeds/replay-1-2.sql`. Idempotent via per-edition delete-then-reinsert, deletes scoped to the `['replay-1','replay-2']` slug allowlist so replay-3 is never touched; users upserted by phone. **Why it matters:** `registrations.seats` is qty (passes), NOT the legacy `Seats used` seat-days column — capacity is derived by expanding over `days[]` in `getConfirmedSeatsByDay`, so map `seats` from `Quantity`/`Seats`, never `Seats used`, or campaign passes double-count. Historical `discount_applied` is a cause-agnostic gross (`base − paid`); guild-vs-credit split isn't recoverable from the source CSVs. Run order: apply the seed before the import (script aborts if the slugs aren't found).
- 2026-05-31 — replay-2 had 21 walk-in registrations with blank phone/email but real names. Per organiser decision each imports as its OWN user with a sequential synthetic phone `0000000000`, `0000000001`, … (`users.name` = the walk-in's name), not collapsed onto one shared row. Two-step rule in `scripts/lib/mappers.ts`: (a) a row whose phone fails `sanitizePhone` first gets a placeholder phone + `source.guest_name`; (b) `assignWalkinPhones(pairs, start)` then walks all walk-in pairs in file/row order and assigns each the next `String(seq).padStart(10,'0')` phone + a user named after `guest_name`. The orchestrator chains the counter across replay-1 → replay-2 regs → orders so numbering is stable + gap-free across re-runs. `source.guest_name` is kept as the placeholder marker. **Why it matters:** (1) each walk-in is now a distinct user, so unique-attendee counts by phone are correct again (142 users = 121 real + 21 synthetic). (2) Deviates from the original spec (which said skip bad-phone rows). (3) Re-running the import reproduces the same synthetic phones deterministically (idempotent) — but it can't recover real phone numbers; correcting those means updating each synthetic user's phone, keyed by name / the `0000000xxx` range (see HANDOFF "Correct replay-2 walk-in placeholder phones").
- 2026-06-02 — Phase 3A admin shipped: worker `/api/admin/*` route group gated in `worker/src/index.ts` by `verifyAccessJwt` reading the CF-injected `Cf-Access-Jwt-Assertion` header; handlers in `worker/src/admin/` (whoami, rebuild, dashboard, registrations list/get/create/patch, leads, audit). SPA in `admin/` (Vite+React+shadcn, single admin role — no guest), port-and-adapt of `bgc-website/admin`. **Auth transport is SAME-ORIGIN, not cross-origin:** the SPA calls RELATIVE `/api/admin/*` on its own host `admin.replaycon.in`, served by the worker via a Workers route `admin.replaycon.in/api/admin/*` (`zone_name = "replaycon.in"`) that takes precedence over the Pages project for that path prefix; `admin/src/lib/api.ts` forces an empty API base when `location.hostname === 'admin.replaycon.in'`. **Why same-origin (this is the key gotcha):** the original cross-origin design (SPA → `api.replaycon.in/api/admin`) was blocked by Cloudflare Access returning **403 to every CORS preflight** — browser `OPTIONS` preflights carry no cookie, so Access rejects them, and configuring the Access app's own CORS settings did NOT fix it in practice (tried, still 403). Same-origin eliminates CORS/preflight entirely. `admin.replaycon.in` is wholly behind the CF Access app (AUD `0983cd2a…132f` = worker `[vars] CF_ACCESS_AUD`), so CF injects the JWT on `/api/admin/*` there too. The worker still emits credentialed CORS via `adminJson` (harmless same-origin; also still covers the `api.replaycon.in/api/admin` path, which exists + is Access-gated but is UNUSED by the SPA). Public api paths (`/api/health`, `/api/register`, `/api/lead`, `/api/ics/*`) stay OUTSIDE Access. Don't "restore" cross-origin calls to api.replaycon.in for admin — it reintroduces the preflight 403.
- 2026-06-02 — The `admin/` SPA has its OWN toolchain (Vite 8 + React 19 + Tailwind v4 `@tailwindcss/vite` plugin, no `tailwind.config.js` + vitest 2), pinned to match `bgc-website/admin` exactly; `BrowserRouter`+`StrictMode` live in `admin/src/main.tsx` (so `App.tsx` uses `<Routes>` with no second Router). Admin vitest setup uses an absolute `setupFiles` path in `admin/vite.config.ts` so the repo-root `vitest.config.ts` (which globs `src/**`) doesn't hijack it. **Why it matters:** the repo's vite-7 pin learning applies ONLY to the root Astro site — do NOT "align" `admin/` deps to it; they're independent. Match bgc admin's versions.
- 2026-06-02 — Admin `leads` screen shows `step_reached` (not email): the `leads` table has NO email column (`worker/src/lead.ts` writes `edition_id, phone, step_reached, name` only). **Why it matters:** don't add an Email column to the leads UI/`LeadRow` type — it'll always be blank. Manual-add registration (`ManualRegistrationDrawer`) currently sends no `edition`, so the worker defaults to the current edition — fine while replay-3 is current, but add an explicit edition selector in Phase 3B before a second edition goes current.
- 2026-06-02 — The `admin/` SPA is built by Cloudflare Pages with **root dir = `admin/`**, so Pages runs `npm ci` against `admin/package.json` ONLY (no repo-root `node_modules` to fall back on). The prod build is `tsc -b && vite build`, and `tsc -b` typechecks `*.test.tsx`, so EVERY package imported by code OR tests under `admin/` must be in `admin/package.json` — a missing test-only dep (`@testing-library/user-event`) failed the Pages build even though it resolved locally by walking up to the repo-root `node_modules`. **Why it matters:** a green local `npm run build` run from `admin/` does NOT prove the Pages build passes; when you add any import under `admin/`, add the dep to `admin/package.json` (not just the repo root). bgc admin doesn't use `user-event`, so it wasn't in the mirrored deps.
- 2026-06-02 — Registrations do NOT require a site rebuild: the public site reads live spot counts + capacity at runtime via the `LiveSpotsBadge`/register islands hitting `GET /api/edition-spots/:id`, and admin manual-add does not fire the deploy hook. **Why it matters:** the "Rebuild site" button (and `POST /api/admin/rebuild`) is only for build-time-baked changes — `registration_status`/`is_published` flips, edition details (dates/venue/pricing/name), schedule, sponsors, hero/about MDX. Don't wire routine registration writes to the deploy hook.
