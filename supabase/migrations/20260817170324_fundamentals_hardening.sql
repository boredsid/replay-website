-- REPLAY fundamentals hardening
--
-- Keeps historical closed editions intact while enforcing the current product
-- contract for every active edition: exactly two consecutive days, non-negative
-- money, valid pass/day combinations, and capacity that includes pending holds.

alter table editions
  add column daily_start_time time not null default '10:00',
  add column daily_end_time time not null default '19:00',
  add constraint editions_daily_time_order
  check (daily_end_time > daily_start_time),
  add constraint editions_active_two_consecutive_days
  check (
    registration_status = 'closed'
    or end_date = start_date + 1
  );

alter table registrations
  add constraint registrations_days_known
    check (days <@ array['day1', 'day2']::text[] and cardinality(days) > 0),
  add constraint registrations_pass_days_match
    check (
      (pass_type = 'oneshot' and cardinality(days) = 1)
      or
      (pass_type = 'campaign' and days @> array['day1', 'day2']::text[] and cardinality(days) = 2)
    ),
  add constraint registrations_amount_non_negative
    check (amount_paid >= 0 and discount_applied >= 0);

alter table products
  add constraint products_values_non_negative
    check (mrp >= 0 and reselling_price >= 0 and (stock is null or stock >= 0));

alter table orders
  add constraint orders_total_non_negative
    check (total >= 0);

alter table schedule_items
  add constraint schedule_time_order
    check (end_time > start_time);

-- Serialize capacity-sensitive registration writes per edition. The trigger
-- counts pending and confirmed registrations, so a pending payment holds its
-- seat until an admin confirms or cancels it. This closes the read-then-insert
-- race even when multiple requests arrive at once.
create or replace function enforce_registration_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  capacity jsonb;
  selected_day text;
  reserved_seats integer;
  day_capacity integer;
begin
  if new.payment_status = 'cancelled' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.edition_id::text, 0));

  select capacity_per_day
    into capacity
    from editions
    where id = new.edition_id
    for update;

  if capacity is null then
    raise exception 'edition_not_found';
  end if;

  foreach selected_day in array new.days loop
    day_capacity := (capacity ->> selected_day)::integer;
    if day_capacity is null then
      raise exception 'invalid_capacity_day:%', selected_day;
    end if;

    select coalesce(sum(seats), 0)::integer
      into reserved_seats
      from registrations
      where edition_id = new.edition_id
        and payment_status in ('pending', 'confirmed')
        and selected_day = any(days)
        and id <> new.id;

    if reserved_seats + new.seats > day_capacity then
      raise exception 'capacity_exceeded:%', selected_day;
    end if;
  end loop;

  return new;
end;
$$;

create trigger registrations_capacity_guard
before insert or update of edition_id, days, seats, payment_status
on registrations
for each row execute function enforce_registration_capacity();

-- A schedule row must fall within its own edition. This cannot be expressed as
-- a simple CHECK because it references another table.
create or replace function enforce_schedule_within_edition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  edition_start date;
  edition_end date;
begin
  select start_date, end_date
    into edition_start, edition_end
    from editions
    where id = new.edition_id;

  if edition_start is null or new.day < edition_start or new.day > edition_end then
    raise exception 'schedule_day_outside_edition';
  end if;

  return new;
end;
$$;

create trigger schedule_within_edition_guard
before insert or update of edition_id, day
on schedule_items
for each row execute function enforce_schedule_within_edition();

-- Setting a new current edition is a single admin action. Clear the prior flag
-- in the same transaction before the unique index is checked.
create or replace function keep_one_current_edition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_current then
    update editions set is_current = false where id <> new.id and is_current = true;
  end if;
  return new;
end;
$$;

create trigger editions_keep_one_current
before insert or update of is_current
on editions
for each row execute function keep_one_current_edition();

create unique index editions_only_one_current
  on editions ((true)) where is_current;
