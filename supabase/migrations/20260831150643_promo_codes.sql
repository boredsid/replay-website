-- Promo codes for public ticket sales.
--
-- A code belongs to one edition and carries both its discount rule and the
-- `applied_message` an attendee sees the moment the code is accepted, so the
-- copy for a campaign is edited in the admin rather than shipped in the site
-- build.
--
-- Redemptions are DERIVED from `registrations.promo_code_id` rather than kept
-- in a counter column, for the same reason capacity is derived from reserved
-- seats: a counter drifts the first time a registration is cancelled or
-- inserted outside the happy path. Pending and confirmed registrations both
-- hold a redemption; cancelled ones release it.

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  -- Stored canonical uppercase. The Worker uppercases input before matching,
  -- so attendees may type it however they like.
  code text not null,
  applied_message text not null,
  internal_note text,
  discount_type text not null check (discount_type in ('percent', 'flat')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  -- Ceiling for a percentage code. Null means uncapped.
  max_discount numeric(10,2) check (max_discount is null or max_discount > 0),
  -- 'booking' discounts the whole order, 'first_ticket' only the buyer's own
  -- ticket the way the Guild Path benefit does.
  scope text not null default 'booking'
    check (scope in ('booking', 'first_ticket')),
  -- Null means the code works on either pass.
  pass_type text check (pass_type in ('oneshot', 'campaign')),
  starts_at timestamptz,
  ends_at timestamptz,
  -- Null means unlimited.
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  max_per_phone int not null default 1 check (max_per_phone > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_code_format
    check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  constraint promo_codes_message_length
    check (char_length(btrim(applied_message)) between 1 and 300),
  constraint promo_codes_note_length
    check (internal_note is null or char_length(internal_note) <= 500),
  constraint promo_codes_percent_range
    check (discount_type <> 'percent' or discount_value <= 100),
  -- A flat code has no use for a ceiling; it is already its own ceiling.
  constraint promo_codes_flat_has_no_cap
    check (discount_type <> 'flat' or max_discount is null),
  constraint promo_codes_window
    check (starts_at is null or ends_at is null or ends_at > starts_at)
);

-- One code per edition. The same word may be reused for a later edition.
create unique index promo_codes_edition_code
  on public.promo_codes (edition_id, code);

create index promo_codes_edition_active
  on public.promo_codes (edition_id, is_active, starts_at, ends_at);

create trigger trg_promo_codes_updated
before update on public.promo_codes
for each row execute function set_updated_at();

alter table public.promo_codes enable row level security;

-- The Worker is the only reader. Codes must never be enumerable from a browser
-- through the Data API, so no grant reaches anon or authenticated.
revoke all on table public.promo_codes from anon, authenticated;
grant select, insert, update, delete on table public.promo_codes to service_role;

-- Registrations -------------------------------------------------------------
-- `promo_code` keeps the redeemed text even if the code row is later removed,
-- so a historical registration always says what was used.
alter table public.registrations
  add column promo_code_id uuid references public.promo_codes(id) on delete set null,
  add column promo_code text,
  add column promo_discount numeric(10,2) not null default 0
    check (promo_discount >= 0);

create index registrations_promo_code_id
  on public.registrations (promo_code_id)
  where promo_code_id is not null;
