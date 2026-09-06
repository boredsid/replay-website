-- Accounts survive staff removal so past finances never lose their owner.
create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null unique,
  name text not null,
  automatic_income boolean not null default false
);
create unique index finance_one_automatic_account on public.finance_accounts (automatic_income) where automatic_income;
insert into public.finance_accounts (staff_email, name, automatic_income)
select email, coalesce(nullif(name, ''), email), coalesce(lower(trim(name)) = 'suranjana datta', false)
from public.staff where roles && array['admin', 'basic_admin']::text[];

-- New/promoted admins get an account; demoted/removed accounts remain in history.
create function public.sync_finance_account() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.roles && array['admin', 'basic_admin']::text[] then
    insert into public.finance_accounts (staff_email, name)
    values (new.email, coalesce(nullif(new.name, ''), new.email))
    on conflict (staff_email) do update set name = excluded.name;
  end if;
  return new;
end;
$$;
create trigger staff_finance_account after insert or update on public.staff
for each row execute function public.sync_finance_account();

create table public.finance_entries (
  id uuid primary key, -- Client-generated id makes a retried create idempotent.
  edition_id uuid not null references public.editions(id),
  account_id uuid not null references public.finance_accounts(id),
  kind text not null check (kind in ('income', 'expense')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 999999999.99),
  description text not null check (length(trim(description)) between 1 and 240),
  category text not null check (length(trim(category)) between 1 and 80),
  entry_date date not null,
  notes text not null default '' check (length(notes) <= 2000),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (length(trim(void_reason)) between 1 and 240),
  check ((voided_at is null) = (void_reason is null))
);
create index finance_entries_edition on public.finance_entries (edition_id, entry_date desc, id);
create index finance_entries_account on public.finance_entries (account_id);
create trigger finance_entries_updated before update on public.finance_entries
for each row execute function public.set_updated_at();

-- Audit and entry commit together. Voiding retains the original record.
create function public.audit_finance_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.admin_audit_log (actor_email, action, target_table, target_id, diff)
  values (new.updated_by,
    case when tg_op = 'INSERT' then 'finance.create'
      when new.voided_at is not null then 'finance.void' else 'finance.update' end,
    'finance_entries', new.id::text,
    jsonb_build_object('before', case when tg_op = 'UPDATE' then to_jsonb(old) else null end, 'after', to_jsonb(new)));
  return new;
end;
$$;
create trigger finance_entries_audit after insert or update on public.finance_entries
for each row execute function public.audit_finance_entry();

alter table public.finance_accounts enable row level security;
alter table public.finance_entries enable row level security;
revoke all on public.finance_accounts, public.finance_entries from public, anon, authenticated;
grant select, insert, update on public.finance_accounts, public.finance_entries to service_role;
revoke delete, truncate on public.finance_accounts, public.finance_entries from service_role;
revoke all on function public.sync_finance_account(), public.audit_finance_entry() from public, anon, authenticated;
grant execute on function public.sync_finance_account(), public.audit_finance_entry() to service_role;

-- A single snapshot avoids partial totals and the Data API's 1,000-row cap.
-- Automatic income is derived, so confirmations, cancellations and edits cannot
-- leave stale or duplicate copies. Only the authenticated Worker can call this.
create function public.finance_snapshot(p_edition_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'edition', (select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'pricing', pricing,
    'capacity_per_day', capacity_per_day, 'start_date', start_date, 'end_date', end_date)
    from public.editions where id = p_edition_id),
  'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
    'staff_email', a.staff_email, 'automatic_income', a.automatic_income,
    'active', coalesce(s.roles && array['admin', 'basic_admin']::text[], false)) order by a.name), '[]'::jsonb)
    from public.finance_accounts a left join public.staff s on s.email = a.staff_email),
  'registrations', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at,
    'payment_status', payment_status, 'amount_paid', amount_paid, 'discount_applied', discount_applied,
    'guild_tier_at_purchase', guild_tier_at_purchase, 'seats', seats, 'days', days)), '[]'::jsonb)
    from public.registrations where edition_id = p_edition_id),
  'partners', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at,
    'organization_name', organization_name, 'payment_status', payment_status,
    'total_amount', total_amount, 'gst_amount', gst_amount)), '[]'::jsonb)
    from public.partners where edition_id = p_edition_id),
  'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by entry_date desc, created_at desc), '[]'::jsonb)
    from public.finance_entries e where edition_id = p_edition_id)
);
$$;
revoke all on function public.finance_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.finance_snapshot(uuid) to service_role;
