-- A playtest never clashes.
--
-- The clash guard exists because nobody can be in two rooms at once. A playtest
-- is not that kind of booking: people drop in, try the prototype for as long as
-- it holds them, and leave. Booking one says "I will come by", not "I am seated
-- here until 16:00", so it must not stand between an attendee and a tournament.
--
-- Keyed on `kind = 'playtest'` rather than on `section = 'playtesting'`. Both
-- describe the same twenty rows today, but the kind is the per-item activity
-- type that every other layer already carries — the app's `overlaps` and the
-- desk's `clashingSession` both read `kind`, and the section is an arrangement
-- of the public schedule page.
--
-- The exemption is symmetric: a playtest neither blocks nor is blocked. Were it
-- one-sided, the same pair of bookings would be reachable by booking the
-- playtest first and refused by booking it second, which is an order-dependence
-- nobody at the desk could explain.
--
-- Both functions are replaced because both compare sessions. `cancel_session_signup`
-- skips a waitlisted candidate who holds something overlapping before promoting
-- them; leaving a playtest in that comparison would silently pass over the
-- person at the front of the queue and hand the seat further back.

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
  clash uuid;
begin
  select id, edition_id, capacity, signup_mode, public_status,
         day, start_time, end_time, is_all_day, kind
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

  -- Locked, not merely read. Two overlapping sessions share no schedule row, so
  -- this is the only thing the clash check below can serialise on.
  select id, edition_id into attendee
    from attendees where id = p_attendee_id for update;
  if attendee.id is null then
    raise exception 'attendee_not_found';
  end if;
  if attendee.edition_id <> item.edition_id then
    raise exception 'wrong_edition';
  end if;

  -- A second tap returns what the first one produced rather than erroring: the
  -- attendee cannot tell a slow network from a failure, and neither should care.
  -- Checked before the clash guard, or re-tapping a booking you already hold
  -- would report it as clashing with itself.
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

  if not item.is_all_day and item.kind <> 'playtest' then
    select s.schedule_item_id into clash
      from session_signups s
      join schedule_items other on other.id = s.schedule_item_id
     where s.attendee_id = p_attendee_id
       and s.status <> 'cancelled'
       and other.public_status = 'published'
       and other.day = item.day
       and not other.is_all_day
       and other.kind <> 'playtest'
       and other.start_time < item.end_time
       and item.start_time < other.end_time
     limit 1;

    if clash is not null then
      raise exception 'session_clash';
    end if;
  end if;

  select count(*)::int into taken
    from session_signups s
   where s.schedule_item_id = p_schedule_item_id
     and s.status = 'confirmed';

  if item.capacity is null or taken < item.capacity then
    insert into session_signups (schedule_item_id, attendee_id, edition_id, status)
    values (p_schedule_item_id, p_attendee_id, item.edition_id, 'confirmed');
    return query select 'confirmed'::text, 0;
    -- Without this the waitlist insert below runs too, for the person who just
    -- took a seat, and the one-live-per-person constraint aborts the whole
    -- transaction: they get no seat and a generic failure. `return query`
    -- appends to the result set and carries on; only a bare `return` leaves.
    return;
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
 * Give up a seat, and hand it to whoever has waited longest *and can take it*.
 *
 * The guard above means a waitlisted attendee cannot have acquired an
 * overlapping booking since queueing, so in theory the skip below never fires.
 * It is here because "in theory" covers neither the bookings that existed before
 * the clash guard nor a session whose times an organiser moves afterwards, and
 * the failure it prevents is silent: a seat handed to somebody who is sitting in
 * another room, while the next person in the queue never hears about it.
 *
 * A playtest is exempt on both sides, exactly as it is above — freeing a seat in
 * one promotes the queue unconditionally, and holding one never disqualifies a
 * candidate.
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
  item record;
  was record;
  next_up uuid;
begin
  select id, day, start_time, end_time, is_all_day, kind
    into item
    from schedule_items
   where id = p_schedule_item_id
     for update;

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
       and (
         item.is_all_day
         or item.kind = 'playtest'
         or not exists (
           select 1
             from session_signups held
             join schedule_items other on other.id = held.schedule_item_id
            where held.attendee_id = s.attendee_id
              and held.schedule_item_id <> p_schedule_item_id
              and held.status = 'confirmed'
              and other.public_status = 'published'
              and other.day = item.day
              and not other.is_all_day
              and other.kind <> 'playtest'
              and other.start_time < item.end_time
              and item.start_time < other.end_time
         )
       )
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
