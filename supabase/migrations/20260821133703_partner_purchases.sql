-- Edition-specific booth and community-engagement purchases.
--
-- Public clients never access this table directly. The public checkout and
-- Cloudflare Access-protected admin app both go through the Worker, which uses
-- the service role. Package prices live on the edition so the public preview,
-- Worker calculation, and future editions share one source of truth.

alter table public.editions
  add column partner_pricing jsonb not null default '{
    "gst_rate": 0.18,
    "standard_booth": 8000,
    "community_booth": 6500,
    "standard_engagement": 3000,
    "patron_engagement": 3500
  }'::jsonb,
  add constraint editions_partner_pricing_shape
  check (
    jsonb_typeof(partner_pricing) = 'object'
    and jsonb_typeof(partner_pricing -> 'gst_rate') = 'number'
    and (partner_pricing ->> 'gst_rate')::numeric >= 0
    and (partner_pricing ->> 'gst_rate')::numeric <= 1
    and jsonb_typeof(partner_pricing -> 'standard_booth') = 'number'
    and (partner_pricing ->> 'standard_booth')::numeric >= 0
    and jsonb_typeof(partner_pricing -> 'community_booth') = 'number'
    and (partner_pricing ->> 'community_booth')::numeric >= 0
    and jsonb_typeof(partner_pricing -> 'standard_engagement') = 'number'
    and (partner_pricing ->> 'standard_engagement')::numeric >= 0
    and jsonb_typeof(partner_pricing -> 'patron_engagement') = 'number'
    and (partner_pricing ->> 'patron_engagement')::numeric >= 0
  );

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete restrict,
  organization_name text not null,
  contact_name text not null,
  phone text not null,
  email text not null,
  website_url text,
  gstin text,
  kind text not null check (kind in ('booth', 'community_engagement')),
  package_key text not null check (package_key in (
    'standard_booth',
    'community_booth',
    'standard_engagement',
    'patron_engagement'
  )),
  days text[] not null,
  details text,
  internal_notes text,
  base_amount numeric(10,2) not null,
  gst_amount numeric(10,2) not null,
  total_amount numeric(10,2) generated always as (base_amount + gst_amount) stored,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'confirmed', 'cancelled')),
  source jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partners_phone_format check (phone ~ '^[0-9]{10}$'),
  constraint partners_days_known check (
    cardinality(days) > 0
    and days <@ array['day1', 'day2']::text[]
  ),
  constraint partners_package_kind_match check (
    (kind = 'booth' and package_key in ('standard_booth', 'community_booth'))
    or
    (kind = 'community_engagement' and package_key in ('standard_engagement', 'patron_engagement'))
  ),
  constraint partners_package_days_match check (
    (
      package_key in ('standard_booth', 'community_booth')
      and cardinality(days) = 2
      and days @> array['day1', 'day2']::text[]
    )
    or
    (
      package_key in ('standard_engagement', 'patron_engagement')
      and cardinality(days) = 1
    )
  ),
  constraint partners_amounts_non_negative check (base_amount >= 0 and gst_amount >= 0),
  constraint partners_website_url_format check (
    website_url is null or website_url ~ '^https?://'
  )
);

create index partners_edition_status
  on public.partners (edition_id, payment_status, created_at desc);
create index partners_edition_kind
  on public.partners (edition_id, kind);
create index partners_phone
  on public.partners (phone);

create trigger trg_partners_updated
before update on public.partners
for each row execute function public.set_updated_at();

alter table public.partners enable row level security;

-- New Supabase projects no longer expose new public-schema tables to the Data
-- API automatically. Be explicit in both directions: only the Worker service
-- role can reach partner contacts and payment state.
revoke all on table public.partners from anon, authenticated;
grant select, insert, update, delete on table public.partners to service_role;
