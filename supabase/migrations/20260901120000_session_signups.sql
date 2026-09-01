-- Session sign-ups with capacity and a waitlist.
--
-- The real risk in this phase is not authorisation, it is arithmetic: two people
-- tapping the last seat at the same instant. PostgREST inserts will not
-- serialise that, so both mutations run as functions that take a row lock on the
-- schedule item and count inside the transaction.

alter table public.schedule_items
  add column capacity int check (capacity is null or capacity > 0);

-- 'app' is an explicit opt-in. Setting a capacity number alone must NOT make a
-- session bookable -- capacity may legitimately just describe how many fit in a
-- room, and turning that into an invitation to book would surprise organisers.
alter table public.schedule_items
  drop constraint schedule_items_signup_mode_check;
alter table public.schedule_items
  add constraint schedule_items_signup_mode_check
    check (signup_mode in ('none', 'walk-in', 'advance', 'on-site', 'app'));

create table public.session_signups (
  id uuid primary key default gen_random_uuid(),
  schedule_item_id uuid not null references public.schedule_items(id) on delete cascade,
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  status text not null check (status in ('confirmed', 'waitlisted', 'cancelled')),
  signed_up_at timestamptz not null default now(),
  cancelled_at timestamptz,
  promoted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Partial unique: a double tap is idempotent, but cancelling then signing up
-- again has to work.
create unique index session_signups_one_live_per_person
  on public.session_signups (schedule_item_id, attendee_id)
  where status <> 'cancelled';

-- Waitlist order is signed_up_at. No position column, because a stored position
-- is one more thing that can drift out of agreement with reality.
create index session_signups_queue
  on public.session_signups (schedule_item_id, status, signed_up_at);

create index session_signups_attendee on public.session_signups (attendee_id);

create trigger trg_session_signups_updated
before update on public.session_signups
for each row execute function public.set_updated_at();

/**
 * Take a seat, or a place in the queue.
 *
 * The `for update` on the schedule row is what makes this safe: two simultaneous
 * callers serialise there, so the second one counts a table that already
 * includes the first one's row.
 */
create or replace function public.sign_up_for_session(
  p_attendee_id uuid,
  p_schedule_item_id uuid
)
returns table (status text, queue_position int)
language plpgsql
set search_path = public
as $$
declare
  item record;
  attendee record;
  taken int;
  existing record;
begin
  select id, edition_id, capacity, signup_mode, public_status
    into item
    from schedule_items
   where id = p_schedule_item_id
     for update;

  if item.id is null then
    raise exception 'session_not_found';
  end if;
  if item.signup_mode <> 'app' then
    raise exception 'session_not_bookable';
  end if;
  if item.public_status <> 'published' then
    raise exception 'session_not_published';
  end if;

  select id, edition_id into attendee from attendees where id = p_attendee_id;
  if attendee.id is null then
    raise exception 'attendee_not_found';
  end if;
  if attendee.edition_id <> item.edition_id then
    raise exception 'wrong_edition';
  end if;

  -- A second tap returns what the first one produced rather than erroring: the
  -- attendee cannot tell a slow network from a failure, and neither should care.
  select s.status, s.signed_up_at into existing
    from session_signups s
   where s.schedule_item_id = p_schedule_item_id
     and s.attendee_id = p_attendee_id
     and s.status <> 'cancelled';
  if existing.status is not null then
    return query
      select existing.status,
             case when existing.status = 'waitlisted'
               then (select count(*)::int from session_signups w
                      where w.schedule_item_id = p_schedule_item_id
                        and w.status = 'waitlisted'
                        and w.signed_up_at <= existing.signed_up_at)
               else 0 end;
    return;
  end if;

  select count(*)::int into taken
    from session_signups s
   where s.schedule_item_id = p_schedule_item_id
     and s.status = 'confirmed';

  if item.capacity is null or taken < item.capacity then
    insert into session_signups (schedule_item_id, attendee_id, edition_id, status)
    values (p_schedule_item_id, p_attendee_id, item.edition_id, 'confirmed');
    return query select 'confirmed'::text, 0;
  end if;

  insert into session_signups (schedule_item_id, attendee_id, edition_id, status)
  values (p_schedule_item_id, p_attendee_id, item.edition_id, 'waitlisted');

  return query
    select 'waitlisted'::text,
           (select count(*)::int from session_signups w
             where w.schedule_item_id = p_schedule_item_id
               and w.status = 'waitlisted');
end;
$$;

/**
 * Give up a seat, and hand it to whoever has waited longest.
 *
 * Promotion happens in this same transaction and is immediate and permanent
 * rather than a held offer. Without push notifications a claim window mostly
 * produces seats nobody knows to claim.
 */
create or replace function public.cancel_session_signup(
  p_attendee_id uuid,
  p_schedule_item_id uuid
)
returns table (cancelled boolean, promoted_attendee_id uuid)
language plpgsql
set search_path = public
as $$
declare
  was record;
  next_up uuid;
begin
  perform 1 from schedule_items where id = p_schedule_item_id for update;

  -- Read the status BEFORE cancelling. `returning` on an update yields the new
  -- row, so returning `status` here would always say 'cancelled' and the
  -- promotion below would never fire — a waitlist that silently never moves.
  select id, status into was
    from session_signups
   where schedule_item_id = p_schedule_item_id
     and attendee_id = p_attendee_id
     and status <> 'cancelled';

  if was.id is null then
    return query select false, null::uuid;
    return;
  end if;

  update session_signups
     set status = 'cancelled', cancelled_at = now()
   where id = was.id;

  -- Only giving up a confirmed seat frees one; leaving the queue promotes nobody.
  if was.status = 'confirmed' then
    select s.attendee_id into next_up
      from session_signups s
     where s.schedule_item_id = p_schedule_item_id
       and s.status = 'waitlisted'
     order by s.signed_up_at
     limit 1;

    if next_up is not null then
      update session_signups
         set status = 'confirmed', promoted_at = now()
       where schedule_item_id = p_schedule_item_id
         and attendee_id = next_up
         and status = 'waitlisted';
    end if;
  end if;

  return query select true, next_up;
end;
$$;

-- Extends the seat-reduction guard now that a seat can also hold bookings.
-- A seat with history is a person; removing them would take their record with
-- them.
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
     and (
       exists (select 1 from check_in_events e where e.attendee_id = a.id)
       or exists (select 1 from session_signups s where s.attendee_id = a.id and s.status <> 'cancelled')
     );

  if used_seats > 0 then
    raise exception 'seat_reduction_blocked:% seats are in use', used_seats;
  end if;

  delete from attendees
  where registration_id = new.id
    and seat_index > new.seats;

  return new;
end;
$$;

alter table public.session_signups enable row level security;

revoke all on table public.session_signups from anon, authenticated;
grant select, insert, update on table public.session_signups to service_role;

-- Cancelling is a status change, never a delete: who held a seat and gave it up
-- is part of the record, and the waitlist promotion above depends on the row
-- still being there.
revoke delete, truncate on table public.session_signups from service_role;
