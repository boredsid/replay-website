-- REPLAY core schema. See docs/superpowers/specs/2026-05-18-replay-rebuild-design.md.

create extension if not exists "pgcrypto";

-- Editions ------------------------------------------------------------------
create table editions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  start_date date not null,
  end_date date not null,
  venue text not null,
  capacity_per_day jsonb not null,       -- {"day1": 60, "day2": 58}
  pricing jsonb not null,                -- {"oneshot":{"day1":600,"day2":600},"campaign":999}
  registration_status text not null
    check (registration_status in ('upcoming','open','sold_out','closed')),
  is_current boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one current edition at a time.
create unique index editions_only_one_current
  on editions ((true)) where is_current;

-- Users ---------------------------------------------------------------------
create table users (
  phone text primary key,                -- 10-digit normalized
  name text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_phone_format check (phone ~ '^[0-9]{10}$')
);

-- Registrations -------------------------------------------------------------
create table registrations (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete restrict,
  user_phone text not null references users(phone) on delete restrict,
  pass_type text not null check (pass_type in ('oneshot','campaign')),
  days text[] not null,                  -- subset of ['day1','day2']
  seats int not null default 1 check (seats > 0),
  amount_paid numeric(10,2) not null default 0,
  discount_applied numeric(10,2) not null default 0,
  guild_tier_at_purchase text
    check (guild_tier_at_purchase in ('initiate','adventurer','guildmaster') or guild_tier_at_purchase is null),
  payment_status text not null
    check (payment_status in ('confirmed','pending','cancelled')),
  source jsonb,                          -- {"utm_source":"...", ...}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index registrations_edition_status on registrations(edition_id, payment_status);
create index registrations_user_phone on registrations(user_phone);

-- Leads ---------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  phone text not null,
  name text,
  step_reached text not null,
  is_junk boolean not null default false,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint leads_phone_format check (phone ~ '^[0-9]{10}$')
);

create index leads_edition_phone on leads(edition_id, phone);

-- Products (pre-order) ------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  name text not null,
  category text not null check (category in ('puzzle','game')),
  mrp numeric(10,2) not null,
  reselling_price numeric(10,2) not null,
  description text,
  image_urls text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  stock int,
  is_available boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_edition_available on products(edition_id, is_available);

-- Orders --------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete restrict,
  user_phone text not null references users(phone) on delete restrict,
  items jsonb not null,                  -- [{product_id, qty, price, name}]
  total numeric(10,2) not null,
  payment_status text not null
    check (payment_status in ('confirmed','pending','cancelled','fulfilled')),
  source jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_edition_status on orders(edition_id, payment_status);

-- Sponsors ------------------------------------------------------------------
create table sponsors (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  name text not null,
  tier text not null check (tier in ('title','gold','silver','partner')),
  logo_url text not null,
  website_url text,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index sponsors_edition_order on sponsors(edition_id, display_order);

-- Schedule ------------------------------------------------------------------
create table schedule_items (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  day date not null,
  start_time time not null,
  end_time time not null,
  title text not null,
  description text,
  location text,
  kind text not null check (kind in ('workshop','tournament','open-play','meal','talk')),
  created_at timestamptz not null default now()
);

create index schedule_edition_day on schedule_items(edition_id, day, start_time);

-- Audit log (admin writes) --------------------------------------------------
create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,
  target_table text not null,
  target_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

-- updated_at triggers -------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_editions_updated before update on editions
  for each row execute function set_updated_at();
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();
create trigger trg_registrations_updated before update on registrations
  for each row execute function set_updated_at();
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

-- RLS -----------------------------------------------------------------------
alter table editions          enable row level security;
alter table users             enable row level security;
alter table registrations     enable row level security;
alter table leads             enable row level security;
alter table products          enable row level security;
alter table orders            enable row level security;
alter table sponsors          enable row level security;
alter table schedule_items    enable row level security;
alter table admin_audit_log   enable row level security;

-- Public read: published editions + their public-safe children.
create policy editions_public_read on editions
  for select using (is_published = true);

create policy sponsors_public_read on sponsors
  for select using (
    exists (select 1 from editions e where e.id = sponsors.edition_id and e.is_published)
  );

create policy schedule_public_read on schedule_items
  for select using (
    exists (select 1 from editions e where e.id = schedule_items.edition_id and e.is_published)
  );

create policy products_public_read on products
  for select using (
    is_available = true and exists (
      select 1 from editions e where e.id = products.edition_id and e.is_published
    )
  );

-- All other tables: no anon access. Service-role (worker) bypasses RLS.
-- (No SELECT/INSERT/UPDATE/DELETE policies = anon denied for users, registrations,
--  leads, orders, admin_audit_log.)
