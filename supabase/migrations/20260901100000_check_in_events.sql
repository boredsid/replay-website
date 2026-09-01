-- Per-day, per-attendee check-in, recorded as an append-only event log.
--
-- Re-entry is a new row; undo is a new row naming the row it voids. Current
-- state is a fold over non-voided rows, so nothing is ever rewritten and the
-- audit trail is the data structure rather than something to remember to write
-- alongside it. The service role gets select and insert only -- deliberately no
-- update or delete, so history cannot be edited even by a bug.
--
-- Check-in is staff-only. There is no attendee-facing write path: the app
-- displays state, it never records it. That is what lets a checked-in attendee
-- be treated as physically present.

create table public.check_in_events (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  day text not null check (day in ('day1', 'day2')),
  kind text not null check (kind in ('in', 'out')),
  voids_event_id uuid references public.check_in_events(id),
  client_event_id uuid not null,
  actor_email text not null,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The kiosk generates client_event_id before queueing, so replaying an offline
-- queue collides here instead of checking one person in twice. This is the
-- whole offline conflict-resolution story: there is no merge logic to get wrong.
create unique index check_in_events_client_dedupe
  on public.check_in_events (client_event_id);

create index check_in_events_state
  on public.check_in_events (attendee_id, day, occurred_at desc);

create index check_in_events_edition_day
  on public.check_in_events (edition_id, day, occurred_at desc);

-- A day nobody bought can never be checked in.
--
-- This lives in the database rather than only in the handler because the Worker
-- uses the service role and bypasses RLS -- a handler-side check alone would
-- leave the rule one bug away from being violated, and a bad check-in surfaces
-- as an argument at the door rather than an exception in a log.
create or replace function public.enforce_check_in_day_purchased()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  purchased_days text[];
begin
  select r.days
    into purchased_days
    from attendees a
    join registrations r on r.id = a.registration_id
   where a.id = new.attendee_id;

  if purchased_days is null then
    raise exception 'attendee_not_found';
  end if;

  if not (new.day = any(purchased_days)) then
    raise exception 'day_not_purchased:%', new.day;
  end if;

  return new;
end;
$$;

create trigger check_in_events_day_guard
before insert on check_in_events
for each row execute function public.enforce_check_in_day_purchased();

-- Replaces the seat-reduction path now that attendees can carry history.
--
-- Increasing seats appends. Decreasing removes trailing rows, but only while
-- they have never checked in -- a seat with history is a person, and deleting
-- them would take their record with them. Later migrations extend this again as
-- sign-ups and loans arrive.
create or replace function public.sync_attendees_on_registration_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  used_seats int;
begin
  if new.seats = old.seats then
    return new;
  end if;

  if new.seats > old.seats then
    perform create_attendee_seats(new.id, new.edition_id, new.user_phone, old.seats + 1, new.seats);
    return new;
  end if;

  select count(*)
    into used_seats
    from attendees a
   where a.registration_id = new.id
     and a.seat_index > new.seats
     and exists (select 1 from check_in_events e where e.attendee_id = a.id);

  if used_seats > 0 then
    raise exception 'seat_reduction_blocked:% seats have checked in', used_seats;
  end if;

  delete from attendees
  where registration_id = new.id
    and seat_index > new.seats;

  return new;
end;
$$;

alter table public.check_in_events enable row level security;

-- Browser roles reach none of this: these rows name who was in the building and
-- when. The Worker is the sole reader and writer, on the server, behind
-- Cloudflare Access.
revoke all on table public.check_in_events from anon, authenticated;
grant select, insert on table public.check_in_events to service_role;

-- The grant above does NOT by itself make this table append-only. Supabase
-- ships `alter default privileges` that hand service_role every privilege on
-- new tables in public, so granting a subset adds nothing and removes nothing.
-- The revoke is what actually enforces it.
revoke update, delete, truncate on table public.check_in_events from service_role;
