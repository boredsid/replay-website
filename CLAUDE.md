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
- 2026-05-22 — Phase 1D cutover shipped: apex `replaycon.in` and `www.replaycon.in` now served by Cloudflare Pages from `main`, not GitHub Pages. Legacy `*.html`, `CNAME`, `.github/workflows/deploy.yml`, `apps-script-preorder.js` removed from `main` (still in `legacy-static` branch). **Why it matters:** the apex is no longer reachable through GitHub Pages — re-enabling it requires re-adding the 4 A + 4 AAAA records + a CNAME, plus enabling GH Pages in repo Settings. Full rollback recipe is in `docs/superpowers/specs/2026-05-22-replay-phase-1d-cutover-design.md`.
- 2026-05-22 — Replay Apps Script `Code.gs` template URL points at `main` post-cutover (was `rebuild/phase-0` during 1A-1C). **Why it matters:** future edits to `src/emails/registration.html` must land on `main` (via PR) for GAS to pick them up. Direct edits on a branch only show up after merging.
- 2026-05-22 — Cloudflare Pages without a `404.html` in `dist/` falls back to serving `index.html` content for any unmatched route, returning a 200 status. **Why it matters:** for real 404 behaviour, add `src/pages/404.astro` (Astro builds it to `dist/404.html`, Pages picks it up automatically). Without it, `/register.html` post-cutover returned the landing page HTML at 200, not a real 404.
- 2026-05-22 — Static assets referenced by absolute path in components (`/link-preview.png`, `/replay-logo.png`) must live under `public/`, not the repo root. **Why it matters:** legacy GitHub Pages served whatever was at repo root; Astro only serves files copied from `public/` into `dist/`. Asset paths look identical in HTML but break post-build if the file is at root.
- 2026-05-22 — Astro defaults to trailing-slash routes (`/register` → 308 → `/register/`). **Why it matters:** that 308 is normal and browsers handle it transparently — don't "fix" it by adding `trailingSlash: 'never'` to `astro.config.mjs` unless you have a specific SEO reason to flatten it. The 308 + final 200 chain is correct behaviour.
