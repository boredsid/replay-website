# REPLAY Phase 1A — Worker layer + edition seed

**Date:** 2026-05-21
**Status:** Approved (brainstorm complete; implementation plan pending)
**Parent:** `docs/superpowers/specs/2026-05-18-replay-rebuild-design.md`
**Branch:** `rebuild/phase-0` (no separate branch — phases build atop each other until 1D cutover)

## Goal

Stand up the worker layer (5 public endpoints) and seed the REPLAY 3 edition so Phase 1B can build pages against real data. Backend reaches functional parity with the legacy registration flow.

## Non-goals

- Any page rendering (1B).
- Pre-order endpoint or pre-order email (1B).
- Design system / visual polish (1C).
- DNS cutover (1D).
- Admin UI for editions/sponsors/schedule (Phase 3).
- User credits, plus-ones, or any feature beyond legacy parity.

## Scope

**In:**
- 5 worker endpoints: `lookup-phone`, `register`, `edition-spots/:editionId`, `cancel-registration`, `lead`.
- REPLAY 3 edition seed at `supabase/seeds/replay-3.sql`.
- `editions.pricing` JSONB shape evolution (adds `adventurer_cap`).
- Registration confirmation email template at `src/emails/registration.html`.
- Guild Path discount logic with per-edition Adventurer cap.
- Anti-split fraud check (one discounted pass per phone per edition).
- Per-day capacity gating (250/250 for replay-3).
- Zero-total bypass (no payment flow when discount = total).
- Lead rate-limiting (2s per phone+edition).
- Replay Apps Script template URL updated to read from `rebuild/phase-0` branch.

**Deferred (with target phase):**

| Item | Target phase |
|---|---|
| `preorder-checkout` worker endpoint | 1B |
| `src/emails/preorder.html` template | 1B |
| `products` seed for replay-3 | 1B (or 1B prerequisite) |
| Public landing / register / preorder / schedule / archive pages | 1B |
| REPLAY palette in Tailwind tokens (full bgc design system port) | 1C |
| Email visual polish | 1C |
| Hero photo + sponsor logo uploads | 1C (manual into Supabase Storage; admin UI is Phase 3) |
| Sponsors + schedule_items seed for replay-3 | 1B or 1C (small SQL alongside consuming pages) |
| Apex DNS cutover from GitHub Pages → CF Pages | 1D |
| Merge bgc PR #15 | 1D |
| PR `rebuild/phase-0` → `main` in replay repo | 1D |
| `editions.registration_status='open'` flip | 1D (post-cutover only) |
| Admin tool (full CRUD across all tables) | Phase 3 |
| Historical edition import (replay-1, replay-2) | Phase 2 |

## Architecture

Single new package work: `worker/src/`. No schema migrations. One new SQL seed file. One new HTML template. Each endpoint follows the bgc pattern: `worker/src/<name>.ts` handler + `worker/src/<name>.test.ts` Vitest with `vi.mock('./supabase')`.

```
worker/src/
├── lookup-phone.ts         + .test.ts
├── register.ts             + .test.ts
├── edition-spots.ts        + .test.ts
├── cancel-registration.ts  + .test.ts
├── lead.ts                 + .test.ts
├── validation.ts           (new: sanitizePhone, jsonResponse, day-set parser)
├── pricing.ts              (new: typed reader for editions.pricing JSONB)
├── editions.ts             (new: fetch edition + capacity helpers)
└── index.ts                (route additions)

supabase/seeds/replay-3.sql
src/emails/registration.html
```

`validation.ts`, `pricing.ts`, `editions.ts` are extracted helpers so each handler stays small and individually testable.

## Data model adjustment

No schema migrations. Only the **shape** inside `editions.pricing` JSONB evolves:

```json
{
  "oneshot": { "day1": 800, "day2": 800 },
  "campaign": 1400,
  "adventurer_cap": 1000
}
```

`worker/src/pricing.ts` reads through a typed helper. Missing `adventurer_cap` defaults to `Infinity` (no cap). Missing `oneshot` / `campaign` causes the helper to throw — endpoint returns 500 with a logged error (data corruption signal, shouldn't happen for any properly-seeded edition).

## Worker endpoints

All return JSON. CORS allows the replay site origin (`https://replaycon.in` + Pages preview URLs). All handlers use `getSupabase(env)` from `worker/src/supabase.ts` (Phase 0 file).

### `POST /api/lookup-phone`

**Input:** `{ phone: string, edition_id: string (uuid) }`

**Reads:**
- `users` by sanitized phone.
- bgc `/api/guild-status` via `bgc-client.ts` (Phase 0).
- `registrations` for `edition_id` + `user_phone`, excluding `payment_status='cancelled'`.

**Output:**
```ts
{
  user: { found: boolean, name: string | null, email: string | null },
  guild: { tier: 'initiate'|'adventurer'|'guildmaster'|null, active: boolean },
  existing_for_edition: { count: number, has_confirmed: boolean },
  discount_blocked: boolean
}
```

`discount_blocked = guild.active && existing_for_edition.count > 0` — the anti-split signal the form uses to grey out the discount preview.

### `POST /api/register`

**Input:** `{ phone, name, email, edition_id, pass_type: 'oneshot'|'campaign', days: ('day1'|'day2')[], source?: object }`

**Logic:**
1. **Validation.** Sanitize phone (`/\D/g`, last 10). Reject if invalid (400). Reject if `days` is empty or contains invalid values (400). Reject if `pass_type='campaign'` and `days !== ['day1','day2']` (400 — campaign must be both days). Reject if `pass_type='oneshot'` and `days.length !== 1` (400 — oneshot is exactly one day).
2. **Edition fetch.** Reject if `registration_status !== 'open'` (409). Pull `pricing` JSONB.
3. **User upsert.** Look up by phone. If none, insert with `phone, name, email`. If exists, overwrite `name`/`email` only if the incoming value is a non-empty string (don't blank existing values).
4. **Base price.** From pricing JSONB: oneshot = `pricing.oneshot[days[0]]`; campaign = `pricing.campaign`.
5. **Guild lookup.** Call bgc `/api/guild-status`. Compute raw discount:
   - none / null → 0
   - initiate → 20% of base (rounded to integer rupee)
   - adventurer → `min(base, pricing.adventurer_cap ?? Infinity)`
   - guildmaster → base
6. **Anti-split check.** If `tier != null` AND any non-cancelled `registrations` row exists for `(edition_id, user_phone)`: override discount = 0, set `discount_blocked = true`, store `guild_tier_at_purchase = null`.
7. **Capacity check.** For each `day` in `days`: `confirmed_seats_on_day + 1 <= capacity_per_day[day]`. If any fails, reject (409 `{error:'sold_out', day}`).
8. **Insert registration.** `seats=1`, `amount_paid = base - discount`, `discount_applied = discount`, `guild_tier_at_purchase` from step 6, `payment_status = 'confirmed'` if `amount_paid === 0` else `'pending'`, `source` from input.
9. **Email.** If `amount_paid === 0`, dispatch confirmation via `apps-script.ts` template `replay-registration`. (If pending, the client renders UPI flow and a separate confirmation step marks it confirmed later — that confirm endpoint is post-1A; legacy behavior is to trust the client's "I paid" click. **Decision:** for 1A, the worker only sets `confirmed` on `amount_paid===0`. The `pending → confirmed` transition stays a manual operation via the eventual admin tool. This matches the legacy "honor system" until admin exists.)
10. **Lead conversion.** Mark any `leads` row matching `(edition_id, phone)` with `converted_at = now()`. Idempotent.

**Output:** `{ registration_id, final_amount, discount_applied, discount_blocked, payment_required: boolean }`

### `GET /api/edition-spots/:editionId`

**Reads:** `editions.capacity_per_day` + sum of `seats` from `registrations` where `edition_id = ? AND payment_status = 'confirmed'`, grouped by day (using `days` array — a `confirmed` row with `['day1','day2']` counts toward both).

**Output:**
```ts
{
  day1: { capacity: number, remaining: number, sold_out: boolean },
  day2: { capacity: number, remaining: number, sold_out: boolean },
  both_sold_out: boolean
}
```

Public, no auth. Used by site for live spot badges.

### `POST /api/cancel-registration`

**Input:** `{ registration_id: string (uuid), phone: string }`

**Logic:**
1. Sanitize phone. Reject if invalid (400).
2. Fetch registration. Reject if not found (404). Reject if `user_phone !== sanitized phone` (403 — anti-grief).
3. Reject if `payment_status === 'cancelled'` already (409 idempotent).
4. Update `payment_status = 'cancelled'`. No refund logic — refunds are manual via UPI (same as legacy).

**Output:** `{ ok: true, registration_id }`

### `POST /api/lead`

**Input:** `{ phone, name?, edition_id, step_reached: 'phone_entered'|'name_entered'|'details_entered' }`

**Logic (matches bgc lead.ts):**
1. Sanitize phone. Reject invalid (400).
2. Verify edition exists. Reject (400) if not.
3. **In-memory rate limit:** map keyed by `phone:edition_id`, drop second call within 2s (200 with `{ok:true}` but no DB write).
4. Look up existing lead `(edition_id, phone)`. If `converted_at != null`, skip writes (return 200). Otherwise upsert with `on_conflict='edition_id,phone'`.

**Output:** `{ ok: true }`

Export `_resetLeadRateLimit()` for tests (matches bgc).

## Testing

Match bgc pattern: Vitest with `vi.mock('./supabase')`. Each endpoint test file mocks the `from()` chain with a hand-built builder. Tests run in `worker/` via `npm test`.

**Coverage per endpoint (4-6 tests each, ~25 total):**

- `lookup-phone`: invalid phone → 400, unknown phone → user.found=false, active guild + no prior reg → discount_blocked=false, active guild + prior confirmed → discount_blocked=true, expired guild → tier=null.
- `register`: invalid input → 400, edition not open → 409, capacity exceeded → 409 with `day`, guildmaster registers free → amount_paid=0 + payment_status=confirmed + email dispatched, adventurer with cap → amount_paid = base - cap, anti-split → discount_blocked + discount=0.
- `edition-spots`: zero registrations → remaining=capacity, mixed confirmed/cancelled → only confirmed counted, day1 sold out → both_sold_out=false, both days sold out → both_sold_out=true.
- `cancel-registration`: phone mismatch → 403, already cancelled → 409, valid cancel → row updated, registration not found → 404.
- `lead`: invalid phone → 400, edition not found → 400, rate-limit drops second call, converted lead skips write, new lead upserts with correct `step_reached`.

`apps-script.ts` `sendEmail` is mocked (`vi.mock('./apps-script')`). `bgc-client.ts` `fetchGuildStatus` is mocked via `vi.mock('./bgc-client')`. Real network calls are never made in tests.

## Edition seed

`supabase/seeds/replay-3.sql`:

```sql
insert into editions (
  slug, name, start_date, end_date, venue,
  capacity_per_day, pricing,
  registration_status, is_current, is_published
) values (
  'replay-3',
  'REPLAY 3',
  '2026-09-12', '2026-09-13',
  'TBD',
  '{"day1": 250, "day2": 250}'::jsonb,
  '{"oneshot": {"day1": 800, "day2": 800}, "campaign": 1400, "adventurer_cap": 1000}'::jsonb,
  'upcoming',
  true,
  false
)
on conflict (slug) do update set
  name             = excluded.name,
  start_date       = excluded.start_date,
  end_date         = excluded.end_date,
  venue            = excluded.venue,
  capacity_per_day = excluded.capacity_per_day,
  pricing          = excluded.pricing;
-- registration_status / is_current / is_published intentionally NOT overwritten,
-- so a re-run never accidentally flips live flags.
```

Applied to production Supabase via `apply_migration` MCP (renamed for clarity — it's a seed, not a schema migration).

## Email template

`src/emails/registration.html`:

- Inline CSS (email client compat).
- Functional shell only — header strip in REPLAY orange (`#F47B20`), monospace `{{variable}}` placeholders for: `{{name}}`, `{{edition_name}}`, `{{venue}}`, `{{start_date}}`, `{{end_date}}`, `{{pass_type}}`, `{{days_label}}` (e.g. "Saturday + Sunday"), `{{seats}}`, `{{amount_paid}}`, `{{discount_applied}}`, `{{guild_tier}}` (empty string if none).
- Worker's `apps-script.ts` `sendEmail` payload sets `template: 'replay-registration'` and `variables: { ... }` matching the placeholders.

**Branch coupling (Apps Script template URL):**
1. During 1A-1C, update the dedicated Replay Apps Script project's `urls` map to point at `…/rebuild/phase-0/src/emails/registration.html` instead of `…/main/…`. Redeploy GAS Web App after edit.
2. At 1D cutover, swap back to `…/main/…` and redeploy GAS once more.

This is a 1-line edit in `apps-script/Code.gs` paste-bait (already documented in Phase 0 spec) and a 30-second GAS UI action.

## Deploy + smoke test

After all code is merged onto `rebuild/phase-0`:

1. `cd worker && npx wrangler deploy` — pushes new endpoints.
2. Apply `replay-3.sql` seed via Supabase MCP `apply_migration` (name: `seed_replay_3`).
3. Update Replay Apps Script template URL to `rebuild/phase-0` and redeploy GAS.
4. Smoke:
   - `POST /api/edition-spots/<replay-3-id>` → `{day1:{capacity:250,remaining:250,...}, ...}`
   - `POST /api/lookup-phone` with `{phone: '<a real guild member>', edition_id: '<replay-3-id>'}` → returns correct tier + `active=true`.
   - `POST /api/register` with `is_published=false` edition is irrelevant; what matters is `registration_status`. Set `registration_status='open'` *temporarily* for the smoke test, register a test row, verify row appears + email arrives, then set it back to `'upcoming'` and `payment_status='cancelled'` on the test row to keep capacity untouched. (Alternative: use a separate test edition in the seed. Decision: temporary flip + cleanup is faster than maintaining a second edition.)

## Open questions for implementation

- Day labels in email (`{{days_label}}`): derived from input days. Use English ("Saturday", "Sunday", "Saturday + Sunday") rather than `day1`/`day2` strings. Implementation can hardcode mapping for replay-3 since both days are weekends; future editions can extend the helper.
- Should `lookup-phone` also return current `edition_spots` so the form can avoid a second roundtrip? **Decision:** No — `edition-spots` is a separate cached-friendly endpoint, keep concerns separate.
- Lead `step_reached` validation: enum check matching bgc's set (`phone_entered`, `name_entered`, `details_entered`). If the form later needs more steps, add to enum + DB check constraint update. Out of 1A scope.
