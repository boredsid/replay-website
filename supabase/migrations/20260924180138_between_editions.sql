-- Between editions: an album link per edition, and the figures the public
-- site shows once an edition has ended.
-- Design: docs/specs/2026-09-24-between-editions-design.md

-- A Google Photos shared album or a Google Drive folder. The Worker narrows
-- the host (worker/src/admin/editions.ts); the database only insists on https,
-- so a widened allowlist needs no migration.
alter table public.editions add column photos_url text;
alter table public.editions add constraint editions_photos_url_https
  check (photos_url is null or photos_url ~ '^https://');

-- Aggregates only: counts, schedule item ids and game titles. No names, phone
-- numbers, attendee ids or game owners, because GET /api/recap/:slug publishes
-- the result verbatim to anyone.
--
-- Counted here rather than in the Worker because PostgREST caps a select at
-- 1,000 rows. REPLAY 3 produced 370 check-in events and 459 sign-up rows; a
-- larger edition would pass the cap and a Worker-side count would undercount
-- without an error.
create or replace function public.edition_recap(p_edition_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with arrivals as (
    -- An arrival is an `in` that is not itself a void and that no other event
    -- voids. The same rule as firstArrivals in worker/src/display-feed.ts;
    -- change both together, or the recap and the floor display disagree about
    -- who came.
    select c.attendee_id, c.day
    from check_in_events c
    where c.edition_id = p_edition_id
      and c.kind = 'in'
      and c.voids_event_id is null
      and not exists (select 1 from check_in_events v where v.voids_event_id = c.id)
  ),
  per_attendee as (
    select attendee_id, count(distinct day) as days
    from arrivals
    group by attendee_id
  ),
  bookings as (
    select g.schedule_item_id, count(*)::int as booked
    from session_signups g
    join schedule_items s on s.id = g.schedule_item_id
    where s.edition_id = p_edition_id
      and g.status = 'confirmed'
    group by g.schedule_item_id
  ),
  loans as (
    select t.title
    from library_loans l
    join library_copies c on c.id = l.copy_id
    join library_titles t on t.id = c.title_id
    where l.edition_id = p_edition_id
      and l.checked_out_at is not null
  ),
  borrowed as (
    select title, count(*)::int as loans
    from loans
    group by title
    order by count(*) desc, title asc
    limit 5
  )
  select jsonb_build_object(
    'attendance', jsonb_build_object(
      'people', (select count(*) from per_attendee),
      'by_day', coalesce(
        (select jsonb_object_agg(day, n)
         from (select day, count(distinct attendee_id)::int as n from arrivals group by day) d),
        '{}'::jsonb),
      'both_days', (select count(*) from per_attendee where days >= 2)
    ),
    'sessions', jsonb_build_object(
      'seats_booked', coalesce((select sum(booked) from bookings), 0),
      'sessions_booked', (select count(*) from bookings),
      'by_item', coalesce(
        (select jsonb_agg(jsonb_build_object('schedule_item_id', schedule_item_id, 'booked', booked)
                          order by booked desc, schedule_item_id)
         from bookings),
        '[]'::jsonb)
    ),
    'library', jsonb_build_object(
      'loans', (select count(*) from loans),
      'most_borrowed', coalesce(
        (select jsonb_agg(jsonb_build_object('title', title, 'loans', loans) order by loans desc, title)
         from borrowed),
        '[]'::jsonb)
    )
  );
$$;

revoke all on function public.edition_recap(uuid) from public, anon, authenticated;
grant execute on function public.edition_recap(uuid) to service_role;
