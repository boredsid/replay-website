# REPLAY Phase 3B — Editions CRUD, Users screen, manual-reg edition selector

**Date:** 2026-06-07
**Status:** Design — approved, pending implementation plan
**Depends on:** Phase 3A admin foundation (`/api/admin/*` gate, SPA shell, audit log)

## Goal

Extend the replay admin SPA (`admin.replaycon.in`) with two new screens and one fix:

1. **Editions** — list all editions, create new ones, and edit any field (status, dates, venue, pricing, capacity, name, publish/current flags) from the UI instead of raw SQL.
2. **Users** — list/search all users, edit name/email/notes, view a user's registrations + orders, and correct a user's phone number (incl. the 21 replay-2 walk-in placeholders).
3. **Manual-add edition selector** — the manual registration drawer currently sends no edition (worker defaults to current) and hardcodes ₹800. Add an explicit edition `<select>` and a non-binding base-price hint. Amount stays manually entered.

Out of scope: products, orders, sponsors, schedule screens (Phase 3C); promo codes; bgc credit redemption; the phone→UUID identity migration (tracked separately in HANDOFF as tech debt).

## Key design decisions

Two operations originally looked tricky because they mutate a key other rows depend on. Both are resolved by **simplifying the database**, not by adding atomic stored procedures:

### Decision 1 — "current edition" is resolved by latest date, not a uniqueness rule

Today a partial unique index (`editions_only_one_current`) enforces exactly one `is_current=true` row, which makes switching the current edition a delicate two-step swap (risk of zero-current or a uniqueness rejection mid-swap).

**Change:** drop the index. Multiple editions may be `is_current=true`. The worker resolves "the current edition" deterministically as **the published edition with the latest `start_date`** (tiebreak `created_at desc`). Admins toggle `is_current`/`is_published` freely with no swap dance; the site always shows the newest published event.

Trade-off accepted: we lose a DB guardrail against "two marked current", but "latest date wins" is deterministic so there is no real ambiguity.

### Decision 2 — phone edits work via `ON UPDATE CASCADE`, not insert/repoint/delete

`users.phone` is the primary key; `registrations.user_phone` and `orders.user_phone` FK to it with `on delete restrict` and (implicitly) no-action on update, which blocks changing a phone while child rows exist.

**Change:** recreate both FKs with `on update cascade` (keep `on delete restrict`). Changing `users.phone` then cascades automatically, so "fix walk-in phone" is a single `update users set phone=… where phone=…`.

This is a deliberate interim. The cleaner long-term fix (surrogate UUID PK) is recorded in `HANDOFF.md` as tech debt; Phase 3B does not do it.

## Database — migration `003`

New file `supabase/migrations/003_phase3b_admin.sql`, two independent changes:

1. `drop index if exists editions_only_one_current;`
2. Drop and recreate the two phone FKs with `on update cascade on delete restrict`:
   - `registrations.user_phone → users(phone)`
   - `orders.user_phone → users(phone)`

Applied to the live Supabase project (`qvkynwlmzeybdiapbcsy`) via MCP.

### Worker change to existing code

`worker/src/editions.ts` — `getCurrentEdition(env)` changes from
`.eq('is_current', true).maybeSingle()`
to: select `is_published=true` editions, `order by start_date desc, created_at desc`, return the first (or null). This is the only behavioral change to existing code; all other worker changes are additive. A test pins the new resolver.

## Worker — new endpoints

All under the existing Access-gated `/api/admin/*` dispatch in `worker/src/index.ts`. All reuse `adminJson`, `writeAudit`, `diffRows`, and the service client.

### Editions — `worker/src/admin/editions.ts`

| Route | Behavior |
|---|---|
| `GET /api/admin/editions` | List all editions (full rows), `order by start_date desc`. Feeds the editions screen and the manual-add edition selector. |
| `POST /api/admin/editions` | Create. Validates: `slug` unique + matches `^[a-z0-9-]+$`; `end_date >= start_date`; `pricing` + `capacity_per_day` shape (reuse `readPricing` + a capacity shape check); `registration_status` in enum. Defaults `is_current=false`, `is_published=false`, `registration_status='upcoming'`. Audit `edition.create`. |
| `PATCH /api/admin/editions/:id` | Partial update of any editable field: `name`, `slug`, `start_date`, `end_date`, `venue`, `pricing`, `capacity_per_day`, `registration_status`, `is_current`, `is_published`. Same validation as create for any field present. Audit `edition.update` with a `diffRows` diff. |

No delete (editions have child registrations). No special "set current" endpoint — with the uniqueness rule gone it is just `PATCH {is_current:true}`.

### Users — `worker/src/admin/users.ts`

| Route | Behavior |
|---|---|
| `GET /api/admin/users?q=&limit=&offset=` | List/search. `q` matches phone substring or name (case-insensitive). Returns `phone, name, email, notes, created_at` + a per-user `registration_count`. Paginated. |
| `GET /api/admin/users/:phone` | One user + their registrations (joined with edition slug/name) + orders, for the detail drawer. |
| `PATCH /api/admin/users/:phone` | Edit `name`, `email`, `notes`. Audit `user.update` with diff. |
| `POST /api/admin/users/:phone/change-phone` | Validate new phone `^[0-9]{10}$` and not already a `users` row → else `400 invalid_phone` / `409 phone_taken`. Then `update users set phone=new where phone=old` (cascades to registrations/orders). Audit `user.phone_change` with `{old,new}`. |

Rationale for a dedicated change-phone route over folding into PATCH: it is a guarded, separately-audited identity change with its own validation; keeping it distinct makes intent explicit and keeps PATCH simple.

## Admin SPA

### Navigation (`admin/src/components/nav.ts`)

Add **Editions** (`/editions`, `Calendar` icon) and **Users** (`/users`, `Users` icon).
Order: Dashboard · Editions · Registrations · Users · Leads · Audit.

### New pages (`admin/src/pages/`)

- **`Editions.tsx`** — list of all editions: slug, name, date range, status badge, current/published flags, capacity. Row → editor drawer. A "New edition" button → `/editions/new`.
- **`EditionDrawer.tsx`** — right-side drawer (mirrors `RegistrationDrawer` pattern) used for both create (`/editions/new`) and edit (`/editions/:id`). Fields: name, slug, start date, end date, venue, `registration_status` `<select>`, `is_current` + `is_published` switches, grouped numeric inputs for pricing (`oneshot.day1`, `oneshot.day2`, `campaign`, `adventurer_cap`) and capacity (`day1`, `day2`). On successful save → **"Rebuild site now?"** confirm dialog → if confirmed, `POST /api/admin/rebuild` (best-effort; failure toasts but the save already committed).
- **`Users.tsx`** — searchable table (phone, name, email, # regs). Debounced search box. Row → user drawer.
- **`UserDrawer.tsx`** (`/users/:phone`) — edit name/email/notes; read-only list of the user's registrations + orders; a guarded **"Change phone number"** sub-action (input + confirm) → change-phone endpoint.

### Routing (`admin/src/App.tsx`)

Mirror the existing list-plus-drawer composition:
- `/editions` → `<Editions/>`
- `/editions/new` → `<Editions/><EditionDrawer/>`
- `/editions/:id` → `<Editions/><EditionDrawer/>`
- `/users` → `<Users/>`
- `/users/:phone` → `<Users/><UserDrawer/>`

### Manual-add change (`admin/src/pages/ManualRegistrationDrawer.tsx`)

Add an edition `<select>` at the top, populated from `GET /api/admin/editions`, defaulting to the resolved current edition. Send the chosen `edition` slug in the POST body (worker already accepts `edition`). Amount stays manually entered; show the selected edition's base price for the chosen pass/days as **non-binding helper text** (e.g. "Base for this pass: ₹800"), not an auto-fill.

### Types (`admin/src/lib/types.ts`)

Add `EditionRow`, `UserRow` (list shape incl. `registration_count`), `UserDetail` (user + registrations + orders).

## Validation & error handling

- Worker is authoritative on all validation; rejects with `adminJson({error}, status)` and a specific error string.
- Client surfaces errors via the existing `fetchAdmin` → `ApiError` → `showApiError` toast path.
- Post-save rebuild is best-effort and decoupled from the save's success.

## Audit

Every mutating route writes an audit row (`edition.create`, `edition.update`, `user.update`, `user.phone_change`). The existing Audit screen covers Phase 3B with no changes.

## Testing

Matches existing suites (worker vitest; admin vitest + Testing Library).

**Worker:**
- `editions.test.ts` — create validation (bad slug, bad dates, bad pricing), patch diff, list ordering.
- `users.test.ts` — search by phone/name, patch name/email/notes, change-phone happy path + `phone_taken` + `invalid_phone`.
- `editions.test.ts` (existing or new case) — `getCurrentEdition` resolves to latest-dated published edition.

**Admin:**
- `Editions.test.tsx` — renders list; drawer create and edit submit correct payloads; rebuild confirm fires `/api/admin/rebuild`.
- `Users.test.tsx` — search filters; edit submits; change-phone confirm posts to the endpoint.
- `ManualRegistrationDrawer.test.tsx` — update for the edition selector (selector renders, selected slug is sent).

**Migration:** applied via Supabase MCP; verify the dropped index and the cascade (a throwaway phone-change round-trip). The real walk-in phone corrections are left to the organiser via the new UI.

## Files

New:
- `supabase/migrations/003_phase3b_admin.sql`
- `worker/src/admin/editions.ts` (+ `.test.ts`)
- `worker/src/admin/users.ts` (+ `.test.ts`)
- `admin/src/pages/Editions.tsx` (+ `.test.tsx`)
- `admin/src/pages/EditionDrawer.tsx`
- `admin/src/pages/Users.tsx` (+ `.test.tsx`)
- `admin/src/pages/UserDrawer.tsx`

Modified:
- `worker/src/index.ts` — dispatch new routes
- `worker/src/editions.ts` — `getCurrentEdition` resolver
- `admin/src/components/nav.ts` — two nav items
- `admin/src/App.tsx` — routes
- `admin/src/lib/types.ts` — new types
- `admin/src/pages/ManualRegistrationDrawer.tsx` (+ `.test.tsx`) — edition selector
- `docs/superpowers/HANDOFF.md` — mark 3B shipped (at implementation time)
