# REPLAY Phase 3A — Admin foundation + registrations + leads

**Date:** 2026-06-01
**Status:** Approved (design)
**Depends on:** Phase 1 (worker + site + Supabase), Phase 0 (admin shell, CF Access, deploy hook)
**Followed by:** Phase 3B (editions CRUD, users, manual-reg pricing automation), Phase 3C (products/orders/sponsors/schedule)

## Why this exists

Phase 3 (the full admin) is multi-week / 9 CRUD screens — too large for one spec. It is decomposed into three dependency-ordered sub-phases. **3A establishes all the plumbing once and ships the screens used day-to-day:** the admin scaffold, the worker `/api/admin/*` gating layer, audit logging, and the Dashboard / Registrations / Leads screens. 3B and 3C reuse this foundation.

The replay `admin/` is currently a bare Vite shell (placeholder `App.tsx`, no router, no shadcn). The worker has a clean handler-per-file structure and a ready `verifyAccessJwt`, but **no `/api/admin/*` routes exist yet**.

## Reference: bgc-website admin

`/Users/siddhantnarula/Projects/bgc-website/admin/` is a complete, working blueprint for the same stack (Vite + React + shadcn + react-router + CF Access). We **port-and-adapt** it: copy the framework-level pieces wholesale, delete bgc-specific resources, build only replay's screens. bgc's worker (`worker/src/index.ts` line ~82) reads the `Cf-Access-Jwt-Assertion` header and verifies it with the same `verifyAccessJwt` replay already has — replay mirrors this exactly.

Rejected alternatives: fresh minimal build (re-solves auth/mobile/revalidate, diverges from the established pattern, forces 3B/3C to backfill the framework); TanStack headless tables (new dependency surface, overkill for ~153 rows).

## Scope (3A)

In scope:
- Admin scaffold (router, shadcn `ui/`, tailwind, Layout/Sidebar + mobile bottom-tab bar, `lib/api`, `whoami`, Toaster, "Rebuild site" button).
- Worker `/api/admin/*` gating + endpoints for whoami, rebuild, dashboard, registrations (list/get/create/patch), leads, audit.
- Audit logging on every mutation (before/after diff).
- Screens: **Dashboard**, **Registrations** (list + drawer + confirm/cancel + manual add), **Leads** (read-only), **Audit log** (read-only).
- **Full mobile-first** UX (port bgc's `BottomTabBar`, `MobileCardList`, `ActionSheet`, `SearchOverlay`).

Out of scope (deferred):
- Editions CRUD, Users screen, manual-registration pricing automation → **3B**.
- Products, Orders, Sponsors, Schedule → **3C**.
- Promo codes, BGC credit redemption → their own phases.
- bgc's guest/`GuestApp` role concept — **dropped**; all 5 CF Access emails are full admins.

## Architecture

### Admin SPA (`admin/`)

- Stays Vite + React + TypeScript. Add `react-router-dom`, shadcn `ui/` (radix primitives + `sonner`), tailwind + postcss config — copied from bgc admin.
- **Dependency pinning:** match bgc admin's known-good lockfile versions. The admin has its own Vite toolchain independent of the Astro site, so the repo's Astro vite-7 pin (in `CLAUDE.md`) does not apply here — bgc admin's versions are the reference of record.
- `App.tsx`: `WhoAmIProvider → AdminRoutes` (single role, no `GuestApp`).
- Routes (react-router):
  - `/` → Dashboard
  - `/registrations` → RegistrationsList
  - `/registrations/new` → RegistrationsList + ManualRegistrationDrawer
  - `/registrations/:id` → RegistrationsList + RegistrationDrawer
  - `/leads` → Leads
  - `/audit` → AuditLog
  - `*` → redirect to `/`
- `Layout`: desktop = sidebar + content region; mobile = bottom-tab bar. Topbar shows `logged in as {email}` and a **"Rebuild site"** button.
- `lib/api.ts`: port bgc's `fetchAdmin` (`credentials: 'include'`, `cache: 'no-store'`, 401 → reload, `ApiError`, `showApiError` via sonner). Base URL = `import.meta.env.PUBLIC_WORKER_URL` (or `VITE_API_BASE`) → `https://api.replaycon.in`.
- `lib/whoami.tsx`: calls `GET /api/admin/whoami`, provides `{ email }` to the tree; on 401 shows a logged-out state.

### Worker (`worker/`)

**Gating** — in `index.ts`, before the public route table:
```
if (path.startsWith('/api/admin/')) {
  const token = req.headers.get('Cf-Access-Jwt-Assertion') || '';
  const result = await verifyAccessJwt(token, env);
  if (!result.ok) return jsonResponse({ error: 'unauthorized', reason: result.reason }, 401);
  // dispatch admin routes, passing result.email
}
```
- Add `Cf-Access-Jwt-Assertion` to `CORS_HEADERS` `Access-Control-Allow-Headers` and set `Access-Control-Allow-Credentials: true`. CORS origin must echo the admin origin (not `*`) when credentials are included.
- Admin handlers live in new files under `worker/src/admin/` (one file per concern) to keep `index.ts` thin and mirror the existing handler-per-file convention.

**Endpoints** (all gated; `email` = verified actor):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/whoami` | `{ email }` |
| POST | `/api/admin/rebuild` | Fire `CLOUDFLARE_PAGES_DEPLOY_HOOK`; audit `site.rebuild` |
| GET | `/api/admin/dashboard?edition=<slug>` | `{ edition, spots_by_day, totals, recent_registrations, recent_leads }` |
| GET | `/api/admin/registrations?edition=&status=&q=` | List (joined with `users` for name) |
| GET | `/api/admin/registrations/:id` | Detail |
| POST | `/api/admin/registrations` | Manual add (user upsert + insert + optional email); audit `registration.create` |
| PATCH | `/api/admin/registrations/:id` | Update `payment_status` (confirm/cancel) and/or `amount_paid`; audit `registration.update` with diff |
| GET | `/api/admin/leads?edition=` | List |
| GET | `/api/admin/audit?limit=` | List, newest-first |

**Audit helper** `writeAudit(sb, { actor_email, action, target_table, target_id, diff })` writes to `admin_audit_log`. For updates, the handler reads the before-row, applies the change, and `diff` holds `{ field: { old, new } }` for changed keys only. For creates, `diff` holds the inserted row. Reads are never logged.

## Data flow & rules

### Manual registration add (lightweight + optional email)
1. Sanitize phone (reuse `validation.sanitizePhone`).
2. **User upsert:** if phone is new → insert `users` row with provided name/email; if it exists → only fill `name`/`email` when the existing value is empty (never clobber a real name).
3. Insert `registrations`: `edition_id`, `user_phone`, `pass_type`, `days[]`, `seats` (derived from days/pass), `amount_paid` (editable; UI suggests the standard price from `editions.pricing` but the worker trusts the submitted amount), `payment_status` (default `confirmed`), `source: { manual: true, by: actor_email }`.
4. **Capacity:** compute confirmed seats for the chosen day(s); if full, return a soft-warning flag — the UI warns but allows override (comp / door entries are intentional). The worker does **not** hard-block.
5. **Optional email:** if the "send confirmation email" toggle is set, POST to the existing `apps-script.ts` registration path (same payload shape as the public register flow). Email failure must not fail the registration write.
6. Audit `registration.create`.

### Confirm / cancel (PATCH)
- Confirm: `payment_status` `pending → confirmed`. Cancel: `→ cancelled`. By registration id, no phone gate (admin is already Access-authenticated — distinct from the public phone-gated `cancel-registration`). No user email is sent. Audit `registration.update` with the status diff.
- Capacity semantics already in the system apply: `cancelled`/`pending` free a seat (per the existing capacity rules), so no extra logic needed here.

### Dashboard
- `spots_by_day`: reuse the worker's existing confirmed-seats-by-day computation (`getConfirmedSeatsByDay` / edition-spots logic) against `editions.capacity_per_day`.
- `totals`: counts by `payment_status`, `revenue = sum(amount_paid)` over confirmed rows.
- `recent_registrations`: latest 10 joined with `users.name`.
- `recent_leads`: latest 10.

## Screens (UX)

- **Dashboard:** per-day spots progress bars, status-count tiles, revenue, recent regs + recent leads. Mobile = stacked cards.
- **Registrations:** `DataTable` (desktop) / `MobileCardList` (mobile). Columns: name · phone · pass_type · days · status badge · amount. Search by name/phone (`SearchOverlay` on mobile). Filter by status. Row → drawer (detail + **Confirm**/**Cancel** via `ActionSheet` on mobile). **Add registration** → `ManualRegistrationDrawer` (the lightweight form: phone → user lookup/create, pass type, days, editable suggested amount, status default Confirmed, "send confirmation email" toggle off by default).
- **Leads:** read-only list (name · phone · email · created).
- **Audit log:** read-only, newest-first; each row shows actor · action · target · time, with an expandable `diff`.

## Auth / ops dependencies (risks)

These are environment/Cloudflare tasks, not code, and must be verified before 3A is "done":

1. **CF Access application for the admin API:** an Access app must cover `api.replaycon.in` path `/api/admin/*` so Cloudflare injects `Cf-Access-Jwt-Assertion` on those requests. Public endpoints (`/api/register`, `/api/lead`, `/api/ics/*`, etc.) must remain **outside** Access.
2. **AUD alignment:** the worker's `CF_ACCESS_AUD` must match the AUD of whatever Access app injects the token on the API path. The handoff's recorded AUD is the **admin SPA app's** — the API path may be a different app with a different AUD. Resolve by either (a) using one Access app that covers both the SPA host and the API admin path, or (b) accepting both AUDs. Confirm against the live Zero Trust config.
3. **Cross-subdomain credentials:** the SPA on `admin.replaycon.in` calls `api.replaycon.in` with `credentials: 'include'`. This relies on Access SSO setting the cookie for the API app. Verify end-to-end in staging (log in, confirm `whoami` returns 200 with the email) before declaring success.

## Testing

- **Worker (vitest, mirror existing style):** auth gate rejects missing/invalid/expired token and a non-allowlisted email; dashboard response shape; registrations list/get/create/patch happy paths + validation failures; manual-add user-upsert non-clobber; audit row written with correct diff on update. Keep the existing 90 tests green.
- **Admin (vitest + testing-library, port bgc test-setup):** Registrations list renders rows from a mocked `fetchAdmin`; manual-add form validation (required phone, etc.); confirm/cancel action calls the right endpoint.
- **Manual verification checklist:** deploy worker → create/confirm the CF Access API app → log into `admin.replaycon.in` → `whoami` shows email → add a test registration → confirm it → cancel it → click "Rebuild site" and observe a Pages deploy → check `admin_audit_log` rows exist for each mutation.

## File map (new/changed)

```
admin/
  package.json                      (+ react-router-dom, shadcn deps, tailwind — bgc-pinned)
  tailwind.config / postcss / components.json   (ported from bgc)
  src/
    App.tsx                         (router + WhoAmIProvider; no GuestApp)
    main.tsx                        (Toaster, router provider)
    components/ui/*                 (shadcn primitives, ported)
    components/{Layout,Sidebar,BottomTabBar,DataTable,FormDrawer,MobileCardList,ActionSheet,SearchOverlay,StatusBadge,...}.tsx  (ported + trimmed)
    lib/{api,whoami,revalidate,utils,types}.ts(x)   (ported + replay-typed)
    pages/{Dashboard,RegistrationsList,RegistrationDrawer,ManualRegistrationDrawer,Leads,AuditLog}.tsx   (new, replay screens)

worker/src/
  index.ts                          (+ /api/admin/* gate + dispatch)
  validation.ts                     (CORS: + Cf-Access-Jwt-Assertion, Allow-Credentials)
  admin/
    whoami.ts
    rebuild.ts
    dashboard.ts
    registrations.ts                (list/get/create/patch)
    leads.ts
    audit.ts                        (writeAudit helper + list handler)
  *.test.ts                         (new tests per handler)
```

## Done criteria

- Admin builds and deploys to `replay-admin` Pages project; routes render on desktop and mobile.
- All `/api/admin/*` endpoints return correct shapes behind the Access gate; unauthenticated calls 401.
- Manual add, confirm, cancel, and rebuild all work end-to-end and write audit rows with correct diffs.
- Worker test suite green (existing 90 + new); admin tests green.
- Ops dependencies (1)–(3) verified in staging.
