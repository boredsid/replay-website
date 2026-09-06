-- Expenses are recorded at their full amount, but many of them carry input GST
-- that could be claimed. Record the credit alongside the expense so the amount
-- is captured at entry time instead of being reconstructed from receipts later.
-- It is recorded only: no total in this system deducts it. Income entries carry
-- no input credit, so the check keeps them at zero.
alter table public.finance_entries
  add column gst_credit numeric(12,2) not null default 0,
  add constraint finance_entries_gst_credit_within_amount
    check (gst_credit >= 0 and gst_credit <= amount),
  add constraint finance_entries_gst_credit_expense_only
    check (kind = 'expense' or gst_credit = 0);

-- finance_snapshot returns entries via to_jsonb(e), so the new column reaches
-- the Worker without changing the function.
