-- The purchaser identity must not be held hostage by a cancelled registration.
--
-- create_attendee_seats attaches the buyer's name and phone to at most one
-- attendee per (edition, phone), so that buying a second seat later does not
-- give one human two attendee records. The claim was never released, though,
-- and the first attempt at a purchase is often the one that dies: an abandoned
-- payment, a retry, a wrong pass type. The cancelled registration kept the
-- name, and the confirmed one that replaced it got an anonymous seat.
--
-- At the door that reads as a broken system. The buyer is not found by name at
-- all — search only matches confirmed registrations — and is found by phone as
-- "Guest 1". Five confirmed registrations are in that state today.
--
-- Releasing the claim on cancellation, rather than loosening the claim check at
-- insert time, is deliberate. Seats are created when the registration row is
-- inserted, while payment is still pending; if a pending claim did not count,
-- two pending registrations for one phone would both claim the buyer and both
-- confirm, which is the duplicate this whole mechanism exists to prevent.
create or replace function public.release_purchaser_seat(p_registration_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  reg record;
  buyer_name text;
  heir uuid;
begin
  select id, edition_id, user_phone into reg
  from registrations where id = p_registration_id;
  if reg.id is null then return; end if;

  -- The seats of a cancelled purchase are not people any more. Clearing their
  -- identity also stops the desk being warned that a phone is "already used"
  -- by a seat nobody will ever check in.
  update attendees
     set display_name = null, phone = null, is_purchaser = false
   where registration_id = reg.id;

  -- Someone else may legitimately hold the claim already — the buyer's live
  -- registration, named at the desk or claimed at insert.
  if exists (
    select 1 from attendees a
     where a.edition_id = reg.edition_id
       and a.phone = reg.user_phone
       and a.is_purchaser
  ) then
    return;
  end if;

  select name into buyer_name from users where phone = reg.user_phone;

  -- The oldest surviving seat 1 for this buyer inherits. Only an anonymous
  -- seat is eligible: a seat the desk has already named belongs to whoever
  -- they named it for, and overwriting that would be worse than a guest label.
  select a.id into heir
    from attendees a
    join registrations r on r.id = a.registration_id
   where a.edition_id = reg.edition_id
     and a.seat_index = 1
     and a.display_name is null
     and a.phone is null
     and r.user_phone = reg.user_phone
     and r.payment_status <> 'cancelled'
   order by r.created_at
   limit 1;

  if heir is not null then
    update attendees
       set display_name = buyer_name, phone = reg.user_phone, is_purchaser = true
     where id = heir;
  end if;
end;
$$;

create or replace function public.sync_attendees_on_registration_cancel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'cancelled' and old.payment_status is distinct from 'cancelled' then
    perform release_purchaser_seat(new.id);
  end if;
  return new;
end;
$$;

-- Only the transition into cancelled is handled. Reinstating a cancelled
-- registration is not repaired: seats are created on insert alone, so nothing
-- re-seats or re-claims on the way back, and the desk has to name those seats
-- again by hand. Left that way deliberately -- the alternative is guessing
-- which of a buyer's registrations should hold the identity once two are live.
drop trigger if exists registrations_release_purchaser on registrations;
create trigger registrations_release_purchaser
after update of payment_status on registrations
for each row execute function public.sync_attendees_on_registration_cancel();

-- Backfill: every registration cancelled before the trigger existed. Oldest
-- first, so a buyer with several dead attempts hands the identity down once,
-- to their live seat rather than to another corpse.
do $$
declare r record;
begin
  for r in
    select id from registrations
     where payment_status = 'cancelled'
     order by created_at
  loop
    perform release_purchaser_seat(r.id);
  end loop;
end $$;
