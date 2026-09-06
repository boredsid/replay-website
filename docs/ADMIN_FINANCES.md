# Admin finances

`/finance` is available to full and basic admins. Desk roles cannot read or write
the finance API. All calls use the existing same-origin Access authentication.

## Income and P&L

- Confirmed registrations contribute `amount_paid`. Confirmed Guild Path
  registrations also contribute `discount_applied` as BGC income credited to
  Suranjana. `guild_tier_at_purchase` identifies that benefit; a promo-winning
  booking has no Guild tier, so its discount is not reimbursed. A multi-ticket
  booking uses the saved total discount once, without multiplying it by seats.
- Confirmed partners contribute `total_amount` to Suranjana's account. The
  saved `gst_amount` is reserved out of net revenue and profit.
- Pending amounts are shown separately. Cancelled payments contribute nothing.
- Automatic rows are derived from the source records, including existing
  records, rather than copied into a second ledger. Edit payment status/amount
  at the source; the next finance refresh reflects that change. Cancelled
  sources are assumed to contribute no retained income, matching the existing
  payment model; this is not a refund or bank reconciliation system.
- Profit is confirmed ticket payments + BGC contributions + confirmed partner
  amounts + manual income − partner GST − active manual expenses. BGC income is
  recognised before settlement. Account totals include BGC and GST and must not
  be interpreted as bank balances or amounts owed between organisers.
- Expenses are entered at their full amount with no input GST recovery assumed.
  Automatic income must not be entered manually again when it settles. Tax
  remittances and transfers between organisers are not operating expenses; this
  version does not implement settlement/transfer bookkeeping.

The break-even calculator rounds the shortfall up by each ticket's expected
income less additional cost. It defaults to the edition's scalar one-day price
(or historical average revenue per ticket for legacy pricing). It assumes one
ticket per registration and no further fixed costs. The average includes BGC
contributions and uses `seats`, not seat-days. Remaining capacity counts pending
and confirmed reservations across days and is expressed as one-day tickets.

## Accounts, entries and audit

`finance_accounts` seeds all existing full/basic admins. The account named
Suranjana Datta is marked `automatic_income`; this applies to existing and new
automatic income across editions. Exactly one account can hold that flag. New
or promoted admins receive an account through a staff trigger. Removed/demoted
accounts remain for history but cannot be selected for new entries. Existing
entries can retain their previous account during a correction.

Manual records in `finance_entries` have an edition, owner account, income/expense
type, date, category, description, amount and optional notes/receipt reference.
The Worker stamps the authenticated creator/editor. Entry edits use optimistic
concurrency via `updated_at`. Client-generated UUIDs make identical create
retries idempotent. Voiding requires a reason and preserves the original record;
there is no delete endpoint. An audit trigger writes the before/after record in
the same transaction as each creation, edit or void.

Both tables enable RLS and deny browser roles. `finance_snapshot(uuid)` is a
service-role-only, security-invoker function returning one consistent edition
snapshot without PostgREST's row-count cap. New data is never service-worker
cached because `/api/*` already uses the admin's network-only policy.

## Rollout and verification

Apply `20260906042208_edition_finances.sql` after checking linked migration state,
then deploy the Worker, then the admin Pages build. No public-site rebuild is
needed. Confirm the automatic account before release:

```sql
select name, automatic_income from public.finance_accounts where automatic_income;
```

It must return Suranjana Datta. If no matching staff record exists in a fresh
environment, set the correct account explicitly before using finances; the API
fails with 503 instead of silently losing automatic income. Changing the
automatic-account flag reattributes all derived automatic rows, including older
editions, so do not use it to model a future payment-recipient change without
adding dated/source-specific allocations first.

Regression coverage is in `worker/src/admin/finance.test.ts`,
`admin/src/lib/finance.test.ts` and `admin/src/pages/Finance.test.tsx`. It covers
Guild vs promo income, multi-ticket and free Guild bookings, statuses, GST,
paise, >1,000 bookings, account access, retry safety, concurrent edits, voiding,
edition selection, error states and break-even calculations.
