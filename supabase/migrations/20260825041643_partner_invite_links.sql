-- Admin-issued partner invite links, and the lifecycle they drive.
--
-- An admin creates a link knowing only three things about a prospective
-- partner: who they are, what they are buying, and what it costs. That row is
-- a LEAD. The partner opens the link, fills in the rest of the form and claims
-- a UPI payment, which makes them PROSPECTIVE. An admin verifies the money
-- landed and the row becomes CONFIRMED.
--
-- `stage` is a generated column rather than a writable one so it can never
-- drift from the columns it is derived from — there is exactly one way to move
-- a partner forward, and it is by setting those columns.
--
-- The same table also gains the sponsorship ladder (docs/SPONSORSHIP.md).
-- Sponsorships are priced per negotiation, so an invite always carries its own
-- amounts instead of reading `editions.partner_pricing`.

alter table public.partners
  add column invite_token text,
  add column invite_created_by text,
  add column invite_expires_at timestamptz,
  add column submitted_at timestamptz,
  add column payment_claimed_at timestamptz;

-- Every row that predates invites was captured with its details already in
-- hand: the website checkout only persists after the buyer claims a payment,
-- and an admin-entered row is typed up from a conversation that already
-- happened. Neither is a lead.
update public.partners set submitted_at = created_at where submitted_at is null;
update public.partners
  set payment_claimed_at = created_at
  where payment_claimed_at is null and source ->> 'channel' = 'website';

alter table public.partners
  add column stage text generated always as (
    case
      when payment_status = 'cancelled' then 'cancelled'
      when payment_status = 'confirmed' then 'confirmed'
      when submitted_at is not null then 'prospective'
      else 'lead'
    end
  ) stored;

-- A lead knows none of the partner's own details yet.
alter table public.partners
  alter column contact_name drop not null,
  alter column phone drop not null,
  alter column email drop not null,
  alter column days set default '{}'::text[];

alter table public.partners
  drop constraint partners_kind_check,
  drop constraint partners_package_key_check,
  drop constraint partners_phone_format,
  drop constraint partners_days_known,
  drop constraint partners_package_kind_match,
  drop constraint partners_package_days_match;

alter table public.partners
  add constraint partners_kind_check
    check (kind in ('booth', 'community_engagement', 'sponsorship')),
  add constraint partners_package_key_check
    check (package_key in (
      'standard_booth',
      'community_booth',
      'standard_engagement',
      'patron_engagement',
      'title_sponsor',
      'association_sponsor',
      'zone_sponsor',
      'gaming_sponsor',
      'venue_sponsor'
    )),
  add constraint partners_package_kind_match check (
    (kind = 'booth' and package_key in ('standard_booth', 'community_booth'))
    or
    (kind = 'community_engagement' and package_key in ('standard_engagement', 'patron_engagement'))
    or
    (kind = 'sponsorship' and package_key in (
      'title_sponsor', 'association_sponsor', 'zone_sponsor', 'gaming_sponsor', 'venue_sponsor'
    ))
  ),
  add constraint partners_phone_format
    check (phone is null or phone ~ '^[0-9]{10}$'),
  add constraint partners_days_known
    check (days <@ array['day1', 'day2']::text[]),
  -- Booths and sponsorships run the whole weekend; a community engagement is
  -- one day. Days stay empty until whoever fills the form picks one, which is
  -- only allowed while the row is still a lead.
  add constraint partners_days_match check (
    (submitted_at is null and cardinality(days) = 0)
    or
    (
      package_key in ('standard_engagement', 'patron_engagement')
      and cardinality(days) = 1
    )
    or
    (
      package_key not in ('standard_engagement', 'patron_engagement')
      and cardinality(days) = 2
      and days @> array['day1', 'day2']::text[]
    )
  ),
  add constraint partners_submitted_has_contact check (
    submitted_at is null
    or (contact_name is not null and phone is not null and email is not null)
  ),
  add constraint partners_claim_after_submit check (
    payment_claimed_at is null or submitted_at is not null
  ),
  add constraint partners_invite_token_format check (
    invite_token is null or invite_token ~ '^[a-z0-9]{24,64}$'
  );

create unique index partners_invite_token_key
  on public.partners (invite_token)
  where invite_token is not null;

create index partners_edition_stage
  on public.partners (edition_id, stage, created_at desc);
