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
