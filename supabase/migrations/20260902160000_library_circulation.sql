-- Game-library circulation: titles, physical copies, and loans.
--
-- The catalogue already existed as `src/data/game-library.json` — 586 titles
-- and 869 physical copies, rebuilt by `npm run sync:library` from the BGC
-- library and four BoardGameGeek collections. That snapshot stays the source of
-- the *metadata*; these tables exist for the thing a JSON file cannot do, which
-- is know where a box currently is.
--
-- The unit is a copy, not a title. Three copies of Catan are three borrowable
-- things, and a model that counts titles cannot answer "is there one left".
--
-- The flow, from the desk's side:
--
--   attendee requests in the app  ->  loan row, status 'requested', 5 minutes
--   attendee shows QR, desk scans ->  status 'checked_out', due in 4 hours
--   attendee brings it back       ->  status 'returned'
--
-- with 'cancelled' (changed their mind), 'expired' (never came), and 'lost'
-- (never came back) as the other terminal states.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.library_titles (
  id uuid primary key default gen_random_uuid(),
  -- Matches `key` in the JSON snapshot ("bgg-447649"), which is what lets the
  -- app hold the catalogue statically and ask the server only about
  -- availability. A REPLAY-owned title with no BGG entry gets its own key.
  key text not null unique,
  bgg_id int,
  title text not null,
  -- Deliberately nothing else. The snapshot owns rating, weight, player counts,
  -- durations and artwork; copying them here would create a second source of
  -- truth that drifts apart on the next `npm run sync:library`. `title` stays
  -- only so the desk's screens can search and print a name without loading a
  -- 267KB catalogue.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index library_titles_title on public.library_titles (lower(title));

create table public.library_copies (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.library_titles(id) on delete cascade,
  -- 1..n within a title, so the desk can say "copy 2 of 3" out loud. The boxes
  -- are not physically labelled; this is the system's handle, not a barcode.
  copy_number int not null check (copy_number > 0),
  -- Reserved for the day somebody does sticker them.
  label text,
  status text not null default 'available' check (status in ('available', 'withdrawn')),
  withdrawn_at timestamptz,
  withdrawn_by text,
  withdrawn_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title_id, copy_number),
  -- A withdrawal without a reason is a copy nobody can put back with
  -- confidence, so the note is part of the state, not an optional extra.
  constraint library_copies_withdrawn_has_reason check (
    (status = 'available' and withdrawn_at is null and withdrawn_note is null)
    or (status = 'withdrawn' and withdrawn_at is not null and withdrawn_note is not null)
  )
);

create index library_copies_title on public.library_copies (title_id)
  where status = 'available';

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------

create table public.library_loans (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.library_copies(id) on delete restrict,
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  status text not null check (status in ('requested', 'checked_out', 'returned', 'cancelled', 'expired', 'lost')),

  requested_at timestamptz not null default now(),
  -- Held for five minutes. Expiry is lazy: nothing sweeps on a timer, the RPCs
  -- retire stale rows on their way past. One less thing to fail on the day.
  request_expires_at timestamptz not null,

  checked_out_at timestamptz,
  -- least(checked_out_at + 4h, close of that day). A game handed over at 20:00
  -- cannot come back at midnight, because the building is shut.
  due_at timestamptz,
  returned_at timestamptz,
  ended_at timestamptz,

  -- Every transition the desk makes is attributed. Requests are not: they come
  -- from the attendee's own device, and the attendee_id already says who.
  checked_out_by text,
  returned_by text,
  ended_by text,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The three rules that must hold no matter what any caller does.
--
-- Partial unique indexes rather than trigger checks: an index cannot be raced,
-- and these are exactly the constraints two people tapping at once would break.
-- They work because expiry flips 'requested' to 'expired' rather than leaving a
-- stale row in place — see expire_stale_library_requests().

/** One live loan per copy: a box cannot be in two people's hands. */
create unique index library_loans_one_open_per_copy
  on public.library_loans (copy_id)
  where status = 'checked_out';

/** One live request per copy. */
create unique index library_loans_one_request_per_copy
  on public.library_loans (copy_id)
  where status = 'requested';

/** One game at a time, per attendee. */
create unique index library_loans_one_open_per_attendee
  on public.library_loans (attendee_id)
  where status = 'checked_out';

/** And one live request, so nobody reserves a shelf. */
create unique index library_loans_one_request_per_attendee
  on public.library_loans (attendee_id)
  where status = 'requested';

create index library_loans_overdue
  on public.library_loans (due_at)
  where status = 'checked_out';

create index library_loans_attendee on public.library_loans (attendee_id);

create trigger trg_library_titles_updated
before update on public.library_titles
for each row execute function public.set_updated_at();

create trigger trg_library_copies_updated
before update on public.library_copies
for each row execute function public.set_updated_at();

create trigger trg_library_loans_updated
before update on public.library_loans
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Time
-- ---------------------------------------------------------------------------

/** How long a copy is held between requesting it and reaching the desk. */
create or replace function public.library_hold_minutes() returns int
language sql immutable as $$ select 5 $$;

/** The maximum a game can be out. */
create or replace function public.library_loan_hours() returns int
language sql immutable as $$ select 4 $$;

/** No new loans this close to the door shutting. */
create or replace function public.library_last_call_minutes() returns int
language sql immutable as $$ select 30 $$;

/**
 * When the venue shuts today, as a timestamptz, or null outside the event.
 *
 * Everything about this event is reasoned about in IST, which is where it
 * happens. Doing it any other way moves the day boundary by five and a half
 * hours and the bug does not appear until someone borrows a game late.
 */
create or replace function public.library_closes_at(p_edition_id uuid, p_now timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  ed record;
  today_ist date;
begin
  select start_date, end_date, daily_end_time into ed
    from editions where id = p_edition_id;
  -- `ed is null` would only be true if every column came back null, which is
  -- not the same question as whether the edition exists.
  if not found or ed.daily_end_time is null then return null; end if;

  today_ist := (p_now at time zone 'Asia/Kolkata')::date;
  if today_ist <> ed.start_date and today_ist <> ed.end_date then return null; end if;

  return (today_ist + ed.daily_end_time) at time zone 'Asia/Kolkata';
end;
$$;

-- ---------------------------------------------------------------------------
-- Lazy expiry
-- ---------------------------------------------------------------------------

/**
 * Retires holds nobody honoured.
 *
 * Called at the top of every mutating RPC rather than run on a schedule. A
 * cron that does not fire leaves copies locked and nobody notices until an
 * attendee is standing at the shelf being told a free game is taken; a lazy
 * sweep cannot fail without the very call that needed it also failing.
 */
create or replace function public.expire_stale_library_requests()
returns void
language sql
set search_path = public
as $$
  update library_loans
     set status = 'expired', ended_at = now()
   where status = 'requested'
     and request_expires_at <= now();
$$;

-- ---------------------------------------------------------------------------
-- Attendee actions
-- ---------------------------------------------------------------------------

/**
 * Holds a copy of this title for five minutes.
 *
 * The `for update` on the chosen copy is what makes this safe. Two people
 * tapping the last copy of Catan at the same instant serialise there, and the
 * second one's insert then loses to the partial unique index rather than
 * quietly double-booking a physical box.
 *
 * Picks the copy; the caller does not get to choose. The boxes are
 * interchangeable and asking an attendee which one they want would be asking
 * them about an implementation detail.
 */
create or replace function public.request_library_copy(
  p_attendee_id uuid,
  p_title_key text
)
returns table (loan_id uuid, copy_id uuid, copy_number int, expires_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  ed_id uuid;
  closes timestamptz;
  chosen record;
  held timestamptz;
begin
  perform expire_stale_library_requests();

  select edition_id into ed_id from attendees where id = p_attendee_id;
  if ed_id is null then raise exception 'attendee_not_found'; end if;

  -- Outside the event there is no closing time to respect, so the last-call
  -- rule has nothing to protect. This mirrors pairingGateDay's relaxation and
  -- exists for the same reason: without it the whole borrowing flow would first
  -- be exercised at the desk on day one, which is the worst place to find a
  -- problem.
  closes := library_closes_at(ed_id);
  if closes is not null and now() > closes - make_interval(mins => library_last_call_minutes()) then
    raise exception 'library_last_call';
  end if;

  -- One game at a time covers the request as well as the loan: without this
  -- somebody could hold a copy while already holding a copy.
  if exists (
    select 1 from library_loans
     where attendee_id = p_attendee_id and status in ('requested', 'checked_out')
  ) then
    raise exception 'already_holding';
  end if;

  -- Aliased: a bare `c.id` would collide with the `copy_id` OUT parameter.
  select c.id as cid, c.copy_number as cnum
    into chosen
    from library_copies c
    join library_titles t on t.id = c.title_id
   where t.key = p_title_key
     and c.status = 'available'
     and not exists (
       select 1 from library_loans l
        where l.copy_id = c.id and l.status in ('requested', 'checked_out')
     )
   order by c.copy_number
   -- `for update of c` locks only the copy row, and `skip locked` sends a
   -- concurrent caller to the next copy instead of making it wait for one it
   -- is not going to get.
   for update of c
   skip locked
   limit 1;

  if not found then raise exception 'no_copy_available'; end if;

  held := now() + make_interval(mins => library_hold_minutes());

  return query
  insert into library_loans (copy_id, attendee_id, edition_id, status, request_expires_at)
  values (chosen.cid, p_attendee_id, ed_id, 'requested', held)
  returning library_loans.id, chosen.cid, chosen.cnum, library_loans.request_expires_at;
end;
$$;

/** Gives the hold back. A mis-tap must not cost five minutes. */
create or replace function public.cancel_library_request(p_attendee_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  cancelled int;
begin
  perform expire_stale_library_requests();

  update library_loans
     set status = 'cancelled', ended_at = now(), ended_by = 'attendee'
   where attendee_id = p_attendee_id and status = 'requested';

  get diagnostics cancelled = row_count;
  return cancelled > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk actions
-- ---------------------------------------------------------------------------

/**
 * Hands a copy over.
 *
 * Takes the copy explicitly rather than reading the attendee's request, for two
 * reasons that both happen in practice: the hold may have lapsed while they
 * walked over — in which case, if the box is still on the shelf, it is theirs —
 * and they may have changed their mind at the counter and want a different
 * game. Any pending request of theirs is consumed either way.
 */
create or replace function public.check_out_library_copy(
  p_attendee_id uuid,
  p_copy_id uuid,
  p_actor text
)
returns table (loan_id uuid, due_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  ed_id uuid;
  closes timestamptz;
  copy record;
  due timestamptz;
begin
  perform expire_stale_library_requests();

  select edition_id into ed_id from attendees where id = p_attendee_id;
  if ed_id is null then raise exception 'attendee_not_found'; end if;

  closes := library_closes_at(ed_id);
  if closes is not null and now() > closes - make_interval(mins => library_last_call_minutes()) then
    raise exception 'library_last_call';
  end if;

  if exists (
    select 1 from library_loans
     where attendee_id = p_attendee_id and status = 'checked_out'
  ) then
    raise exception 'already_borrowing';
  end if;

  select id as cid, status as cstatus into copy from library_copies where id = p_copy_id for update;
  if not found then raise exception 'copy_not_found'; end if;
  if copy.cstatus <> 'available' then raise exception 'copy_withdrawn'; end if;

  -- Somebody else's live hold on this box is the one thing that stops it.
  if exists (
    select 1 from library_loans
     where copy_id = p_copy_id
       and status in ('requested', 'checked_out')
       and attendee_id <> p_attendee_id
  ) then
    raise exception 'copy_taken';
  end if;

  -- Their own hold, on this copy or another, is consumed by the handover.
  update library_loans
     set status = 'cancelled', ended_at = now(), ended_by = p_actor
   where attendee_id = p_attendee_id and status = 'requested';

  -- Four hours, capped at closing when there is a closing to cap at.
  due := now() + make_interval(hours => library_loan_hours());
  if closes is not null then due := least(due, closes); end if;

  return query
  insert into library_loans (
    copy_id, attendee_id, edition_id, status,
    request_expires_at, checked_out_at, due_at, checked_out_by
  )
  values (p_copy_id, p_attendee_id, ed_id, 'checked_out', now(), now(), due, p_actor)
  returning library_loans.id, library_loans.due_at;
end;
$$;

/**
 * Takes a copy back, and optionally takes it out of circulation.
 *
 * The withdrawal rides along in the same transaction because a damaged box is
 * noticed exactly once, at the counter, with the attendee standing there. Two
 * separate actions would mean the second one is the one that gets forgotten.
 */
create or replace function public.return_library_loan(
  p_loan_id uuid,
  p_actor text,
  p_withdraw_note text default null
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  loan record;
begin
  select id as lid, copy_id as cid, status as lstatus into loan
    from library_loans where id = p_loan_id for update;
  if not found then raise exception 'loan_not_found'; end if;
  if loan.lstatus <> 'checked_out' then raise exception 'loan_not_open'; end if;

  update library_loans
     set status = 'returned', returned_at = now(), ended_at = now(),
         returned_by = p_actor, ended_by = p_actor
   where id = p_loan_id;

  if p_withdraw_note is not null and btrim(p_withdraw_note) <> '' then
    perform withdraw_library_copy(loan.cid, p_actor, p_withdraw_note);
  end if;

  return true;
end;
$$;

/**
 * Takes a copy off the shelf.
 *
 * Usable at either counter moment: opening the box at checkout and finding
 * pieces missing, or taking it back damaged. A live hold on the copy is
 * released, because the attendee waiting for it needs to pick something else.
 */
create or replace function public.withdraw_library_copy(
  p_copy_id uuid,
  p_actor text,
  p_note text
)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_note is null or btrim(p_note) = '' then raise exception 'note_required'; end if;

  if exists (select 1 from library_loans where copy_id = p_copy_id and status = 'checked_out') then
    raise exception 'copy_on_loan';
  end if;

  update library_loans
     set status = 'cancelled', ended_at = now(), ended_by = p_actor,
         note = 'copy withdrawn: ' || p_note
   where copy_id = p_copy_id and status = 'requested';

  update library_copies
     set status = 'withdrawn', withdrawn_at = now(),
         withdrawn_by = p_actor, withdrawn_note = btrim(p_note)
   where id = p_copy_id and status = 'available';

  return found;
end;
$$;

/** Puts a withdrawn copy back, once whatever was wrong with it is sorted. */
create or replace function public.restore_library_copy(p_copy_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  update library_copies
     set status = 'available', withdrawn_at = null,
         withdrawn_by = null, withdrawn_note = null
   where id = p_copy_id and status = 'withdrawn';
  return found;
end;
$$;

/**
 * Gives up on a copy that never came back.
 *
 * Without a terminal state here an unreturned game is overdue forever and its
 * copy unavailable forever, and there is no way to close the books at the end
 * of the weekend.
 */
create or replace function public.mark_library_loan_lost(
  p_loan_id uuid,
  p_actor text,
  p_note text default null
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  loan record;
begin
  select id as lid, copy_id as cid, status as lstatus into loan
    from library_loans where id = p_loan_id for update;
  if not found then raise exception 'loan_not_found'; end if;
  if loan.lstatus <> 'checked_out' then raise exception 'loan_not_open'; end if;

  update library_loans
     set status = 'lost', ended_at = now(), ended_by = p_actor, note = p_note
   where id = p_loan_id;

  -- The box is gone, so the copy goes with it rather than sitting "available"
  -- for somebody to be sent looking for.
  update library_copies
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = p_actor,
         withdrawn_note = coalesce(p_note, 'not returned')
   where id = loan.cid and status = 'available';

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

alter table public.library_titles enable row level security;
alter table public.library_copies enable row level security;
alter table public.library_loans enable row level security;

-- Nothing reaches these except the Worker, which authorises every attendee
-- request against a device token and every desk request against an Access JWT.
revoke all on table public.library_titles from anon, authenticated;
revoke all on table public.library_copies from anon, authenticated;
revoke all on table public.library_loans from anon, authenticated;

grant select, insert, update on table public.library_titles to service_role;
grant select, insert, update on table public.library_copies to service_role;
grant select, insert, update on table public.library_loans to service_role;

-- A loan is a record of what happened to a physical object, and deleting one
-- destroys the only evidence of who had it. Every ending is a status, never a
-- disappearance. Titles and copies are seeded rather than churned.
revoke delete, truncate on table public.library_titles from service_role;
revoke delete, truncate on table public.library_copies from service_role;
revoke delete, truncate on table public.library_loans from service_role;
