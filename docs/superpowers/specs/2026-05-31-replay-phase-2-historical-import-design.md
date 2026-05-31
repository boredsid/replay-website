# REPLAY Phase 2 — Historical edition import (design)

**Date:** 2026-05-31
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session

## Goal

Import the registration and pre-order history of the two past REPLAY editions
(replay-1, replay-2) into the new Supabase stack, so the data lives alongside
replay-3 and can power a future "Past editions" page (and admin views). The
import is a developer-run one-off, not a live endpoint.

## Source data

Three CSV exports, provided by the organiser and dropped into a **gitignored**
`scripts/data/` directory (they contain attendee PII — names, phones, emails —
and must never be committed to the public repo).

### `replay-1-registrations.csv` (50 rows)
Columns: `Timestamp, Phone Number, Name, Status, Seats, Paid`
- Single-day event. `Status` ∈ {Paid, Cancelled}. `Seats` = 1. `Paid` = 800.
- No email, no pass-type, no day column (all attendees are day1 oneshot).

### `replay-2-registrations.csv` (102 rows)
Columns: `Timestamp, Name, Phone, Email, Pass Type, Day, Quantity, Paid, Discount, Payment Status, Seats used, Source`
- `Pass Type` ∈ {"One Shot (Day Pass)", "Campaign (2-Day Pass)"}.
- `Day` ∈ {"Saturday, Apr 18", "Sunday, Apr 19", "Both days"}.
- `Payment Status` ∈ {Paid, Canceled (one L), Pending}.
- `Discount` is free text: `"Guildmaster (100% off)"`, `"Adventurer (71% off)"`,
  `"150 Credits Used"`, or blank.
- `Seats used` is a derived seat-days column (2 for a campaign) — **ignored** (see Seats below).
- `Source` ∈ {Website, WhatsAround, Swiggy, …}.

### `replay-2-preorders.csv` (12 rows)
Columns: `Timestamp, Name, Phone, Email, Order Details, Amount paid, Payment Status`
- `Order Details` is a JSON array string: `[{"name":"…","qty":1,"price":399}, …]`.

## Edition metadata (confirmed by organiser)

| | replay-1 | replay-2 |
|---|---|---|
| name | REPLAY 1 | REPLAY 2 |
| start_date | 2026-01-31 | 2026-04-18 |
| end_date | 2026-01-31 | 2026-04-19 |
| venue | The Bangalore Local, Koramangala | The Bangalore Local, Koramangala |
| capacity_per_day | `{"day1":50}` | `{"day1":150,"day2":150}` |
| pricing | `{"oneshot":{"day1":800},"campaign":null,"adventurer_cap":1000}` | `{"oneshot":{"day1":800,"day2":800},"campaign":1400,"adventurer_cap":1000}` |
| registration_status | `closed` | `closed` |
| is_current | false | false |
| is_published | true | true |

- Year is **2026** for both (matches CSV timestamps; supersedes the stale "2025"
  in legacy docs). Both fall before replay-3 (Sep 2026).
- Both passes included ₹200/day as F&B cover at the venue — informational only,
  not modelled separately (the ₹800 / ₹1400 totals already include it).
- `is_published=true` so the public RLS `editions_public_read` policy exposes them
  to the future Past-editions page.

## Architecture

A standalone, idempotent TypeScript script run with `tsx`, talking to Supabase
with the service-role key (bypasses RLS). Chosen over generated SQL seeds because
phone normalization, day/pass mapping, guild-tier parsing, and JSON order-details
handling are all awkward in raw SQL, the source CSVs will be iterated on, and the
generated rows would leak PII if committed.

### File layout
```
scripts/
├── data/                          # gitignored — raw CSVs (PII)
│   ├── replay-1-registrations.csv
│   ├── replay-2-registrations.csv
│   └── replay-2-preorders.csv
├── import-historical.ts           # entrypoint (tsx)
├── lib/
│   ├── csv.ts                     # robust quoted/multiline CSV parser
│   └── mappers.ts                 # pure CSV-row → DB-row mappers
└── import-historical.test.ts      # vitest, covers the mappers
supabase/seeds/
└── replay-1-2.sql                 # seeds the two historical editions
```

- New devDep: `tsx` (only runtime addition).
- New npm script: `"import:historical": "tsx scripts/import-historical.ts"`.
- `.gitignore` gains `scripts/data/`.
- Config: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` read from a gitignored
  `scripts/.env` (or root `.env`, already gitignored).
- `@supabase/supabase-js` reused (already a dependency for the site/worker).

### Modules and responsibilities

- **`lib/csv.ts`** — parse a CSV string into `Record<string,string>[]`, correctly
  handling quoted fields, embedded commas, and embedded newlines (the
  `Order Details` JSON contains commas and quotes). Single exported
  `parseCsv(text: string): Record<string,string>[]`. No I/O.
- **`lib/mappers.ts`** — pure functions, no I/O, fully unit-tested:
  - `sanitizePhone(input): string` — ported from `worker/src/validation.ts`
    (strip non-digits, require ≥10, take last 10). Returns `''` if invalid.
  - `parsePaymentStatus(raw): 'confirmed'|'cancelled'|'pending'` — case-insensitive:
    `paid`→confirmed, starts-with `cancel`→cancelled, `pending`→pending.
  - `parsePassAndDays(passType, day): { pass_type, days }` — replay-2 logic;
    replay-1 callers pass fixed `oneshot` / `['day1']`.
  - `parseGuildTier(discountText): 'initiate'|'adventurer'|'guildmaster'|null` —
    case-insensitive keyword match; `null` for "Credits Used"/blank.
  - `parseOrderItems(raw): {name,qty,price}[]` — `JSON.parse` the Order Details
    cell, validate shape, throw on malformed.
  - `normalizeChannel(source): 'website'|'whatsaround'|'swiggy'` — default `website`.
  - `mapReplay1Registration(row)`, `mapReplay2Registration(row, pricing)`,
    `mapReplay2Order(row)` — assemble the final DB row objects.
- **`import-historical.ts`** — orchestration + I/O only: load env, read the three
  CSVs from `scripts/data/`, run the per-edition flow, print summaries, honor
  `--dry-run`.

## CSV → DB mapping

### Users (upsert by phone; fed by all three files)
- `phone` = `sanitizePhone(...)`, `name`, `email` (replay-1 → null).
- Most-complete-wins: when the same phone appears across files, keep the first
  non-empty `name`/`email` seen (registration files processed before preorders).
- Rows whose phone fails `sanitizePhone` are **skipped** and logged with line number.

### Registrations
| Field | replay-1 | replay-2 |
|---|---|---|
| `edition_id` | replay-1 id | replay-2 id |
| `user_phone` | sanitized phone | sanitized phone |
| `pass_type` | `oneshot` | "One Shot…"→`oneshot`, "Campaign…"→`campaign` |
| `days` | `['day1']` | Sat→`['day1']`, Sun→`['day2']`, Both→`['day1','day2']` |
| `seats` | `Seats` (qty) | `Quantity` (qty) — **not** `Seats used` |
| `amount_paid` | `Paid` | `Paid` |
| `discount_applied` | 0 | `max(0, expected_base − amount_paid)` |
| `guild_tier_at_purchase` | null | parse from `Discount` text, else null |
| `payment_status` | `parsePaymentStatus(Status)` | `parsePaymentStatus(Payment Status)` |
| `source` | `{"channel":"website"}` | `{"channel": normalizeChannel(Source)}` |

- **Seats semantics:** the live `getConfirmedSeatsByDay` (`worker/src/editions.ts:31`)
  sums `seats` into each day present in `days[]`. So `seats` is **qty purchased
  (passes/people)**, and capacity utilisation is derived by day-expansion. Mapping
  the replay-2 `Seats used` seat-days column into `seats` would double-count
  campaign passes — hence `seats` = `Quantity`.
- **`expected_base`** for the discount derivation comes from the edition's pricing:
  oneshot = `pricing.oneshot[day]`; campaign = `pricing.campaign`. Multiplied by
  `seats`.
- **`discount_applied` is cause-agnostic.** replay-2's `Discount` column mixes guild
  discounts and credit usage; the import records one gross reduction number and
  separately parses `guild_tier_at_purchase`. Historical credit-vs-guild split is
  not recoverable from the source and is not attempted. (The future "BGC credit
  redemption" phase is forward-only — see HANDOFF.md.)

### Orders (replay-2 preorders only)
| Field | Value |
|---|---|
| `edition_id` | replay-2 id |
| `user_phone` | sanitized phone |
| `items` | `parseOrderItems(Order Details)` → `[{name,qty,price}]` |
| `total` | `Amount paid` |
| `payment_status` | `parsePaymentStatus(Payment Status)` (`confirmed`/`cancelled`/`pending`) |
| `source` | `{"channel":"website"}` |

- Duplicate phones across orders are kept (each is a distinct order).

## Idempotency & run flow

1. Apply `supabase/seeds/replay-1-2.sql` to upsert the two edition rows
   (`on conflict (slug) do update …`, same pattern as `replay-3.sql`; live flags
   not overwritten on re-run).
2. The script resolves edition ids by slug, then per historical edition:
   - upsert users,
   - `delete from registrations where edition_id = <id>`, then insert all parsed rows,
   - (replay-2 only) `delete from orders where edition_id = <id>`, then insert orders.
3. Re-running yields identical DB state. Every delete is **scoped to a historical
   edition_id**, so replay-3 data is never touched. Users are only upserted, never
   deleted (shared across editions; a stray delete would break FK references).

## Error handling & safety

- `--dry-run` flag: parse + validate + print summary, write nothing.
- Per-edition summary printed: rows read, users upserted, registrations inserted
  (confirmed/cancelled/pending split), orders inserted, and skipped rows (bad
  phone, unparseable day/pass, malformed order JSON) with source line numbers.
- A malformed `Order Details` JSON aborts that row with a logged error rather than
  inserting a broken `items` blob; the run continues and reports it in the skip list.
- Script refuses to run against a non-historical edition id (hard guard: only
  `replay-1` / `replay-2` slugs are eligible for the delete-and-reload path).

## Testing

- `scripts/import-historical.test.ts` (vitest, same runner as the rest of the repo)
  covers the pure mappers with fixture rows:
  - phone sanitization (spaces, `+91`, short → skip),
  - payment-status normalization incl. "Canceled" (one L),
  - pass/day mapping for all three `Day` values,
  - guild-tier parsing incl. "Credits Used" → null,
  - order-items JSON parse incl. a malformed-throws case,
  - channel normalization.
- No DB integration test (one-off script); correctness of the write path is
  verified by a `--dry-run` against the real CSVs before the live run.

## Out of scope (captured as future phases in HANDOFF.md)

- BGC credit redemption at replay checkout (forward-only; this import folds
  historical credit usage into the gross `discount_applied`).
- Promo codes.
- Guild-member import (guild data lives in bgc now).
- The Past-editions page itself (separate pending phase; consumes this data).
