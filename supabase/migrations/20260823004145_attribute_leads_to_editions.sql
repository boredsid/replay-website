-- Attribute a lead to the first edition whose event has not yet ended in the
-- event timezone. This keeps post-edition leads untagged until the next edition
-- exists, then backfills them when that edition is created.

alter table public.leads
  alter column edition_id drop not null;

alter table public.leads
  drop constraint leads_edition_id_fkey;

alter table public.leads
  add constraint leads_edition_id_fkey
  foreign key (edition_id)
  references public.editions(id)
  on delete set null;

-- A phone may have one lead per edition and one currently-untagged lead. The
-- NULLS NOT DISTINCT clause lets PostgREST upsert the untagged row repeatedly.
drop index if exists public.leads_edition_phone_unique;
create unique index leads_edition_phone_unique
  on public.leads (edition_id, phone) nulls not distinct;

create or replace function public.lead_target_edition_id(p_created_at timestamptz)
returns uuid
language sql
stable
set search_path = ''
as $$
  select e.id
  from public.editions e
  where e.end_date >= (p_created_at at time zone 'Asia/Kolkata')::date
  order by e.start_date, e.id
  limit 1
$$;

create or replace function public.attribute_lead_to_edition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  matching_registration_at timestamptz;
begin
  new.edition_id := public.lead_target_edition_id(new.created_at);

  if new.edition_id is not null and new.converted_at is null then
    select min(r.created_at)
      into matching_registration_at
    from public.registrations r
    where r.edition_id = new.edition_id
      and r.user_phone = new.phone;

    if matching_registration_at is not null then
      new.converted_at := matching_registration_at;
    end if;
  end if;

  return new;
end;
$$;

create trigger leads_attribute_to_edition
before insert or update of edition_id, phone, created_at
on public.leads
for each row execute function public.attribute_lead_to_edition();

create or replace function public.attribute_untagged_leads_after_edition_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.leads l
  set edition_id = public.lead_target_edition_id(l.created_at)
  where l.edition_id is null
    and public.lead_target_edition_id(l.created_at) is not null;

  return null;
end;
$$;

create trigger editions_attribute_untagged_leads
after insert or update of start_date, end_date
on public.editions
for each statement execute function public.attribute_untagged_leads_after_edition_change();

create or replace function public.mark_matching_lead_converted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.leads
  set converted_at = coalesce(converted_at, new.created_at)
  where edition_id = new.edition_id
    and phone = new.user_phone
    and converted_at is null;

  return new;
end;
$$;

create trigger registrations_mark_matching_lead_converted
after insert or update of edition_id, user_phone
on public.registrations
for each row execute function public.mark_matching_lead_converted();

-- Align historical rows with the same rules. Existing conversion timestamps
-- are preserved; only missing timestamps with a matching registration fill in.
update public.leads l
set edition_id = public.lead_target_edition_id(l.created_at);

update public.leads l
set converted_at = matching.first_registration_at
from (
  select l2.id as lead_id, min(r.created_at) as first_registration_at
  from public.leads l2
  join public.registrations r
    on r.edition_id = l2.edition_id
   and r.user_phone = l2.phone
  where l2.converted_at is null
  group by l2.id
) matching
where l.id = matching.lead_id;

comment on column public.leads.edition_id is
  'First edition whose end date is on or after the lead creation date in Asia/Kolkata; null until such an edition exists.';

comment on column public.leads.converted_at is
  'Timestamp of the first matching registration insertion; remains set if that registration is later cancelled or removed.';
