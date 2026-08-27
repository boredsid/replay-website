# REPLAY website

The public website and operations console for [REPLAY](https://replaycon.in), Bangalore's board-game convention.

## What lives here

- `src/` — Astro public site, React registration and partner-checkout islands, schedule, SEO metadata, and email templates.
- `app/` — installable Vite/React attendee PWA for the live schedule, local agenda, event status, and organiser announcements.
- `worker/` — Cloudflare Worker for registration, partner purchases, capacity, Guild Path discounts, confirmation emails, calendar files, attendee announcements, and the protected admin API.
- `admin/` — installable Vite/React operations console for registrations, partners, editions, programme data, sponsor logos, and scheduled announcements behind Cloudflare Access. Its service worker caches only the static app shell, never admin API responses.
- `supabase/` — database migrations and edition seed data.
- `apps-script/` — source for the registration and partner-email relay. Its deployed URL and signing key are secrets, never repository configuration.
- `scripts/` — historical import tooling plus the build-time image steps (sponsor-logo normalisation, link-preview rendering) and the vendored Space Grotesk TTFs those steps draw with. Source CSV files are intentionally ignored.
- `sponsor-logos/` — legacy homepage partner/sponsor logos. The wall's primary source is now the `sponsors` table, which admins fill in from the console's **Sponsors** page: they upload the artwork (stored in the public `sponsor-logos` Supabase bucket), set the link the logo opens, and order the wall by tier. Files still in this folder are appended after the uploaded sponsors, so artwork nobody has migrated keeps showing; a sponsor row of the same name replaces its file, which is then safe to delete. Either way the next public-site build updates the wall — the wall is baked in at build time, so an upload reaches replaycon.in only after a rebuild. Artwork does not need to be pre-cropped or transparent: an Astro integration in `astro.config.mjs` (also runnable directly as `npm run normalize:logos`) trims each mark out of its canvas and re-seats it on a shared 480x320 tile in `src/generated/sponsor-logos/`. Marks on a solid dark or coloured background are left untrimmed on purpose — see `src/lib/logo-normalize.ts`.

## Current stack

- Astro 7 and React 19
- Vite 7 attendee PWA
- Cloudflare Pages, Workers, Access, and native rate limiting
- Supabase/Postgres
- Vite 8 admin application
- Vitest 4 test suites
- Locally generated UPI QR codes; no registration or payment details are sent to a QR-image service

## Local setup

Use Node 24 or a compatible current Node release.

Public site:

```sh
npm ci
npm run dev
```

Create `.env.local` with:

```dotenv
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
PUBLIC_WORKER_URL=http://localhost:8787
PUBLIC_UPI_ID=
```

Attendee app:

```sh
npm run dev:app
```

Set `VITE_WORKER_URL=http://localhost:8787` when the local app should use a
local Worker. Production defaults to `https://api.replaycon.in`.

Worker:

```sh
cd worker
npm ci
npm run dev
```

Admin:

```sh
cd admin
npm ci
npm run dev
```

The admin uses a same-origin `/api/admin/*` route in production. Cloudflare Access supplies the identity assertion; do not replace this with a browser-stored admin token.

## Verification

Run the public site, attendee app, admin, and Worker checks before publishing:

```sh
npm test
npm run build
npm run test:app
npm run check:app
npm run build:app

cd admin
npm test
npm run build

cd ../worker
npm test
npx tsc --noEmit
```

Also run `npm audit` independently in the repository root, `admin/`, and `worker/` because they have separate dependency trees.

## Database changes

Migrations are append-only under `supabase/migrations/`. Review linked/local migration state before applying a new migration. The current data contract includes:

- one explicit current, published edition;
- exactly two consecutive days for active editions, while preserving closed historical editions;
- one scalar price for either one-day choice and one price for the full two-day pass;
- public bookings support 1–10 tickets in one registration row, with `seats` storing the quantity;
- Guild Path benefits apply to the member's first eligible ticket in a multi-ticket booking;
- pending and confirmed registrations both reserve capacity;
- partner package pricing is stored per edition, while every partner purchase preserves its base, GST, and final totals as a transaction snapshot;
- partner purchases are operational records in the private `partners` table, separate from the `sponsors` table that drives the homepage logo wall;
- sponsor logos are uploaded through the admin, held in the public `sponsor-logos` storage bucket, and each carries an optional link the public logo opens in a new tab;
- a partner's stage (`lead` → `prospective` → `confirmed`, or `cancelled`) is a generated column derived from `submitted_at` and the payment status, so it can never drift from them;
- the `partners` table also carries the sponsorship ladder; sponsorship amounts are negotiated per partner rather than read from `editions.partner_pricing`;
- database-level validation for pass/day combinations, non-negative amounts, schedule bounds, and concurrent capacity writes.
- programme items grouped into all-day, timed, playtesting, publisher-showcase, and event-floor sections, with draft/published/cancelled public state;
- public programme host, location, sign-up method, and display ordering managed through the protected admin.
- private organiser announcements with explicit publish windows, severity, audience, and audit history; browsers receive only the active public payload through the Worker.

## Registration and payment behavior

- Continuing from the public form performs a read-only payment preview; closing or abandoning the UPI sheet creates no registration.
- Clicking “I've paid” creates a pending registration, which then reduces availability.
- A zero-cost Guild Path registration skips UPI and is confirmed immediately.
- A booking can contain 1–10 tickets, limited further by live availability for the selected day or days.
- Guild Path discounts apply only to the buyer's first ticket; additional tickets are charged at full price.
- An admin confirmation changes it to confirmed and then sends the confirmation email.
- Two-day passes are unavailable if either event day is sold out.
- UPI payment opens through a device deep link and a locally rendered QR code.
- Booth and community-engagement buyers use the same preview-then-record UPI handoff on Get Involved: opening or abandoning UPI creates no row, “I've paid” creates the pending partner record, and admins then verify or cancel it.
- Confirming a pending partner record in admin sends the partner confirmation email; editing a confirmed record does not resend it.

### Partner invite links

- An admin creates a link from **Partners → Create link** with three facts: partner name, partner type, and the amount. That row is a **lead**.
- The link is `https://replaycon.in/partner/?t=<token>` and is sent to the partner by WhatsApp or email. The page is `noindex` and excluded from the sitemap.
- The partner fills in contact details, what they will run, and (for a single-day engagement) their day. Saving those makes them **prospective**; they then pay the link's amount by UPI and press “I've paid”, which records a payment claim without confirming it.
- The amount is never taken from the partner's browser: the link carries the price the admin agreed, and only an admin can change it.
- An admin verifies the money and sets the payment status to confirmed, which makes the partner **confirmed** and sends the partner confirmation email.
- Filling a lead's contact details in by hand in admin promotes it to prospective the same way the link does.

## Deployment and secrets

The public site, attendee app, and admin are separate Cloudflare Pages projects;
the API is a Cloudflare Worker. Deploy the Worker before the attendee app when
the bootstrap contract changes. The attendee app is built to `app/dist/`; its
service worker retains the most recent successful event bootstrap for offline
use. Announcements are live runtime data and do not require rebuilding the
public website or attendee app. Edition and programme changes baked into the
static public site still require the protected admin rebuild action.

The social link preview at `/link-preview.png` is drawn during the build from
the current edition, so a rebuild also refreshes the dates and venue shown
when someone shares a link. There is no per-edition artwork to export.

Keep all of the following in Cloudflare/Apps Script secret storage only:

- Supabase service key
- Apps Script URL and signing secret
- BGC cross-service secret
- Cloudflare Pages deploy-hook URL
- Cloudflare Access audience and admin allowlist where appropriate

If any endpoint or credential appears in source, documentation, logs, or chat, rotate it. Deleting it from the current tree does not remove it from Git history and is not a substitute for rotation.

## Next milestone

Use [docs/LIVE_EVENT_READINESS.md](docs/LIVE_EVENT_READINESS.md) for the dedicated content and operational launch session before registration opens.

## Historical notes

The detailed build history remains under `docs/superpowers/`. Those files are reference material, not the operational source of truth. Prefer this README, the current migrations, and tested code when older notes disagree.
