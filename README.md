# REPLAY website

The public website and operations console for [REPLAY](https://replaycon.in), Bangalore's board-game convention.

## What lives here

- `src/` — Astro public site, React registration islands, schedule, SEO metadata, and the registration-email template.
- `worker/` — Cloudflare Worker for registration, capacity, Guild Path discounts, confirmation emails, calendar files, and the protected admin API.
- `admin/` — Vite/React operations console behind Cloudflare Access.
- `supabase/` — database migrations and edition seed data.
- `apps-script/` — source for the registration-email relay. Its deployed URL and signing key are secrets, never repository configuration.
- `scripts/` — historical import tooling. Source CSV files are intentionally ignored.

## Current stack

- Astro 7 and React 19
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

Run all three suites and both builds before publishing:

```sh
npm test
npm run build

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
- pending and confirmed registrations both reserve capacity;
- database-level validation for pass/day combinations, non-negative amounts, schedule bounds, and concurrent capacity writes.

## Registration and payment behavior

- The public form creates a pending reservation for a paid pass.
- Pending reservations reduce availability immediately.
- An admin confirmation changes it to confirmed and then sends the confirmation email.
- Campaign passes are unavailable if either event day is sold out.
- UPI payment opens through a device deep link and a locally rendered QR code.

## Deployment and secrets

The public and admin sites are Cloudflare Pages projects; the API is a Cloudflare Worker. Edition changes baked into the static site require the protected admin rebuild action.

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
