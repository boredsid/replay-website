-- One row per purchased seat.
--
-- A registration can cover several people: `registrations.seats` is a real
-- purchased quantity, but only the buyer's phone is stored. The friend on seat
-- 2 has no record anywhere, so anything personal keyed on registration_id would
-- collapse N humans into one — one shared QR, one seat in a session, and no way
-- for that friend to sign up for anything themselves.
--
-- Everything personal that follows (check-in, pairing, credentials, sign-ups,
-- loans, push) keys on an attendee instead.
--
-- Seat rows are maintained by trigger rather than by application code. There are
-- two registration paths today (public register and the admin's manual add) and
-- a registration without its seats is invisible until someone cannot be found at
-- the door, so the guarantee belongs in one place the application cannot skip.

create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  seat_index int not null check (seat_index > 0),
  display_name text,
  phone text,
  is_purchaser boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendees_phone_format check (phone is null or phone ~ '^[0-9]{10}$')
);

-- Seat numbers are unique and gapless within a registration; the reconcile
-- function below depends on that to know which rows a seat reduction removes.
create unique index attendees_seat_per_registration
  on public.attendees (registration_id, seat_index);

-- The desk searches by phone: the buyer's, or a guest's if one was captured.
create index attendees_edition_phone
  on public.attendees (edition_id, phone)
  where phone is not null;

create index attendees_registration on public.attendees (registration_id);

create trigger trg_attendees_updated
before update on public.attendees
for each row execute function public.set_updated_at();

-- Creates seats 1..n for a registration.
--
-- Seat 1 normally represents the purchaser and inherits their phone and name;
-- every other seat starts anonymous. "Guest 2" is a supported state end to end,
-- not a gap to be filled before things work — an attendee who never gives a
-- name must still check in, pair, and book.
--
-- The exception matters: a phone may hold SEVERAL registrations for one
-- edition, because buying another seat later creates a new registration rather
-- than editing the first. Claiming the purchaser identity again would give one
-- human two attendee records — two QRs, two pairings, and two seats in the same
-- session — while recording the guest they actually bought for as the buyer.
--
-- So the purchaser identity attaches to at most one attendee per (edition,
-- phone). Later registrations for that phone create anonymous seats, which is
-- what they are: additional people. The desk can name them at check-in, and
-- search still finds them through registrations.user_phone.
create or replace function public.create_attendee_seats(
  p_registration_id uuid,
  p_edition_id uuid,
  p_user_phone text,
  p_from_seat int,
  p_to_seat int
)
returns void
language plpgsql
set search_path = public
as $$
declare
  buyer_name text;
  purchaser_taken boolean;
  seat int;
  claims_purchaser boolean;
begin
  select name into buyer_name from users where phone = p_user_phone;

  select exists (
    select 1 from attendees
    where edition_id = p_edition_id
      and phone = p_user_phone
      and is_purchaser
  ) into purchaser_taken;

  for seat in p_from_seat..p_to_seat loop
    claims_purchaser := (seat = 1 and not purchaser_taken);

    insert into attendees (registration_id, edition_id, seat_index, display_name, phone, is_purchaser)
    values (
      p_registration_id,
      p_edition_id,
      seat,
      case when claims_purchaser then buyer_name else null end,
      case when claims_purchaser then p_user_phone else null end,
      claims_purchaser
    );

    if claims_purchaser then
      purchaser_taken := true;
    end if;
  end loop;
end;
$$;

create or replace function public.sync_attendees_on_registration_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform create_attendee_seats(new.id, new.edition_id, new.user_phone, 1, new.seats);
  return new;
end;
$$;

create trigger registrations_create_attendees
after insert on registrations
for each row execute function public.sync_attendees_on_registration_insert();

-- Reconciles seat rows when the purchased quantity changes.
--
-- Increasing appends. Decreasing removes the trailing seats, but only while
-- they carry no history — a seat that has checked in, booked a session, or
-- borrowed a game is a person, and quietly deleting them would take their
-- records with them.
--
-- Later migrations replace this function as dependent tables appear; today
-- there are none, so a reduction is always safe.
create or replace function public.sync_attendees_on_registration_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.seats = old.seats then
    return new;
  end if;

  if new.seats > old.seats then
    perform create_attendee_seats(new.id, new.edition_id, new.user_phone, old.seats + 1, new.seats);
  else
    delete from attendees
    where registration_id = new.id
      and seat_index > new.seats;
  end if;

  return new;
end;
$$;

create trigger registrations_sync_attendees
after update of seats on registrations
for each row execute function public.sync_attendees_on_registration_update();

-- Backfill. Cancelled registrations get seats too: cancelling later must not
-- destroy check-in history, so status is filtered at query time rather than by
-- withholding rows here.
do $$
declare
  reg record;
begin
  for reg in select id, edition_id, user_phone, seats from registrations loop
    perform create_attendee_seats(reg.id, reg.edition_id, reg.user_phone, 1, reg.seats);
  end loop;
end;
$$;

alter table public.attendees enable row level security;

-- Grants decide whether a Data API role can reach the table; RLS then limits
-- rows. The Worker is the sole reader/writer and uses the service role only on
-- the server. Browser roles get nothing: these rows carry attendee names and
-- phone numbers.
revoke all on table public.attendees from anon, authenticated;
grant select, insert, update, delete on table public.attendees to service_role;
