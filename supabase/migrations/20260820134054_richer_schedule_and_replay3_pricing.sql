-- Richer public programme model plus the approved REPLAY 3 ticket prices.
-- Existing schedule rows remain published programme items. New rows created by
-- the admin default to draft at the API layer until an organiser publishes them.

alter table public.schedule_items
  drop constraint if exists schedule_items_kind_check,
  drop constraint if exists schedule_time_order;

alter table public.schedule_items
  alter column start_time drop not null,
  alter column end_time drop not null,
  add column section text not null default 'programme',
  add column is_all_day boolean not null default false,
  add column host_name text,
  add column signup_mode text not null default 'none',
  add column signup_url text,
  add column public_status text not null default 'published',
  add column display_order integer not null default 0;

alter table public.schedule_items
  add constraint schedule_items_section_check
    check (section in ('always-on', 'programme', 'playtesting', 'publisher-showcase', 'event-floor')),
  add constraint schedule_items_kind_check
    check (kind in (
      'workshop', 'tournament', 'open-play', 'meal', 'talk', 'ttrpg',
      'puzzle', 'quiz', 'social-game', 'playtest', 'publisher-showcase',
      'booth', 'food', 'merch', 'amenity', 'special'
    )),
  add constraint schedule_items_signup_mode_check
    check (signup_mode in ('none', 'walk-in', 'advance', 'on-site')),
  add constraint schedule_items_public_status_check
    check (public_status in ('draft', 'published', 'cancelled')),
  add constraint schedule_items_display_order_check
    check (display_order >= 0),
  add constraint schedule_items_timing_check
    check (
      (is_all_day and start_time is null and end_time is null)
      or
      (not is_all_day and start_time is not null and end_time is not null and end_time > start_time)
    ),
  add constraint schedule_items_signup_url_check
    check (signup_url is null or signup_url ~ '^https?://');

-- Existing rows were published before this field existed. New direct inserts
-- should fail closed unless an organiser deliberately publishes them.
alter table public.schedule_items
  alter column public_status set default 'draft';

drop policy if exists schedule_public_read on public.schedule_items;
create policy schedule_public_read on public.schedule_items
  for select
  to anon, authenticated
  using (
    public_status in ('published', 'cancelled')
    and exists (
      select 1
      from public.editions e
      where e.id = schedule_items.edition_id
        and e.is_published
    )
  );

create index schedule_edition_public_order
  on public.schedule_items (
    edition_id,
    public_status,
    day,
    section,
    display_order,
    start_time
  );

update public.editions
set pricing = jsonb_set(
  jsonb_set(
    jsonb_set(pricing, '{oneshot,day1}', '700'::jsonb, true),
    '{oneshot,day2}', '700'::jsonb, true
  ),
  '{campaign}', '1200'::jsonb, true
)
where slug = 'replay-3';
