-- One person, one session at a time.
--
-- Nobody can be in two rooms at once, so a booking that overlaps one they
-- already hold is not a preference to discourage, it is a seat taken out of
-- circulation for somebody who could have used it.
--
-- Enforced in `sign_up_for_session` rather than in the Worker for the same
-- reason capacity is: two overlapping sessions are two different schedule rows,
-- so two simultaneous taps would not serialise anywhere. The attendee row is now
-- locked as well, which is what makes the second tap count a table that already
-- contains the first one's booking.
--
-- Deliberate exclusions, all of which are silence rather than oversight:
--   * all-day items have no times, and treating them as filling the day would
--     make one open-play sign-up block the entire programme;
--   * cancelled sessions are not happening, so a booking left on one must not
--     stand in the way of booking its replacement;
--   * touching ends do not overlap — a session ending at 14:00 and one starting
--     at 14:00 are back to back, which is a schedule, not a clash.
--
-- Waitlisted bookings count as held. Promotion is immediate and permanent, so
-- someone queued for a session may be confirmed into it at any moment; letting
-- them hold an overlapping seat in the meantime just moves the double-booking
-- to a point where nobody is watching.

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
         day, start_time, end_time, is_all_day
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

  if not item.is_all_day then
    select s.schedule_item_id into clash
      from session_signups s
      join schedule_items other on other.id = s.schedule_item_id
     where s.attendee_id = p_attendee_id
       and s.status <> 'cancelled'
       and other.public_status = 'published'
       and other.day = item.day
       and not other.is_all_day
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
 * this migration nor a session whose times an organiser moves afterwards, and
 * the failure it prevents is silent: a seat handed to somebody who is sitting in
 * another room, while the next person in the queue never hears about it.
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
  select id, day, start_time, end_time, is_all_day
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
