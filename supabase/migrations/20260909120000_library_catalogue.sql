-- The game catalogue moves out of git and into this table.
--
-- `library_titles` was deliberately thin -- key, bgg_id, title -- because
-- `src/data/game-library.json` owned the metadata, and the original migration
-- warned that copying it here "would create a second source of truth that
-- drifts apart on the next npm run sync:library".
--
-- That warning was right while the JSON was authoritative. It stops applying
-- when this table *is* the catalogue and the JSON is deleted, which is what
-- this migration is for. The drift it warned about is what made the change
-- necessary: taking six games off the shelf on 2026-09-09 took a pull request,
-- a 1,000-request BoardGameGeek merge and a 175-line diff to a committed file.
--
-- The rule that replaces the warning is one owner per column:
--
--   sync:library      title, year, thumb, players, minutes, rating, weight,
--                     best_with -- and only where source is 'bgg' or 'bgc'
--   the admin         shelf_status, off_shelf_*, copies_override, and every
--                     column of a row whose source is 'manual'
--   sync:descriptions description
--
-- A 'manual' row is never touched by a sync. That is what makes "add a game
-- BoardGameGeek has never heard of" safe: the next harvest cannot delete it.

alter table public.library_titles
  add column year int,
  -- BoardGameGeek box art. Null draws a monogram tile, as it does today for
  -- the handful of games BGG does not list at all.
  add column thumb text,
  -- Trimmed to ~300 characters by sync:descriptions. The full BGG text is
  -- ~1,600 a game, which would take the app's catalogue from 48KB gzipped to
  -- about 300KB -- paid on first open, on venue wifi, by everyone.
  add column description text,
  add column min_players int,
  add column max_players int,
  -- Minutes.
  add column min_time int,
  add column max_time int,
  -- BGG community average, 0-10.
  add column rating numeric(4, 2),
  -- BGG community weight, 1-5.
  add column weight numeric(4, 2),
  -- Player counts the BGG poll calls "best". Empty when unpolled.
  add column best_with int[] not null default '{}',
  -- Where the row came from, and therefore who may overwrite it.
  add column source text not null default 'bgg'
    check (source in ('bgg', 'bgc', 'manual')),
  add column shelf_status text not null default 'on_shelf'
    check (shelf_status in ('on_shelf', 'off_shelf')),
  add column off_shelf_note text,
  add column off_shelf_at timestamptz,
  add column off_shelf_by text,
  -- What the admin says is on the shelf, when that differs from what the
  -- collections lend. Replaces the old `<bggId>@<collection>` exclusion form:
  -- "that owner stopped bringing theirs" and "there are two, not three" are
  -- the same fact from the page's side, and the page is the only side that
  -- publishes. Zero is not a count -- a game nobody is bringing goes off the
  -- shelf, where it can be seen and put back.
  add column copies_override int
    check (copies_override is null or copies_override > 0);

-- Mirrors library_copies_withdrawn_has_reason, for the same reason: a removal
-- nobody can explain is a removal nobody can confidently undo.
alter table public.library_titles
  add constraint library_titles_off_shelf_has_reason check (
    (shelf_status = 'on_shelf'
      and off_shelf_at is null and off_shelf_note is null and off_shelf_by is null)
    or (shelf_status = 'off_shelf'
      and off_shelf_at is not null and off_shelf_note is not null)
  );

-- The admin list is "everything on the shelf, by name", and the desk searches
-- the same way.
create index library_titles_shelf on public.library_titles (shelf_status, lower(title));
-- One card per game. Two on-shelf rows sharing a BoardGameGeek id is not a
-- legitimate state -- it is the duplicate-card bug the alias table exists to
-- repair -- so the database refuses it rather than leaving it to be noticed on
-- the page. Off-shelf rows are exempt: a merged row keeps its id and steps
-- aside, which is exactly the state a repair leaves behind.
create unique index library_titles_one_card_per_game
  on public.library_titles (bgg_id)
  where bgg_id is not null and shelf_status = 'on_shelf';

-- ---------------------------------------------------------------------------
-- Sync aliases
-- ---------------------------------------------------------------------------

-- Replaces src/data/bgc-bgg-ids.tsv.
--
-- The BGC club sheet has no BGG id column, so a row normally finds its game by
-- folded title. When BoardGameGeek spells it differently -- the sheet's
-- "Vallamkali" is BGG's "Vallamkali: Boat Races of Alappuzha" -- the match
-- fails and the row becomes a second card for a game already on the shelf,
-- with no box art. This is the override that repairs it, and it has to outlive
-- a harvest: src/data/bgg/*.tsv is replaced wholesale when a collection is
-- refreshed, so a fix made there comes straight back undone.
create table public.library_title_aliases (
  -- titleKey() in src/lib/game-library.ts: case, punctuation, accents, spaces
  -- and leading articles removed, so "Q.E." meets "QE".
  folded_title text primary key,
  bgg_id int not null,
  -- Why, for whoever reads this list in a year. "Scout" returns four different
  -- games on BGG and a wrong id merges two real games onto one card, so the
  -- reasoning is worth keeping next to the decision.
  note text,
  created_at timestamptz not null default now(),
  created_by text
);

-- ---------------------------------------------------------------------------
-- Where the list comes from
-- ---------------------------------------------------------------------------

-- One row, rewritten by sync:library, read by GET /api/catalogue.
--
-- The public page's "Where this list comes from" cards are aggregates the
-- harvest computes and nothing else can: "4 collectors pooling their shelves"
-- is a count of collection files, which the table of games does not know.
--
-- They are deliberately anonymous. The four BoardGameGeek sources are personal
-- handles and the BGC sheet carries first names; neither has ever reached the
-- browser, and putting the summary here must not become the way they start.
-- Store the aggregate, never the lender.
create table public.library_catalogue_meta (
  id boolean primary key default true check (id),
  -- LibrarySourceSummary[] — { label, detail, count }.
  sources jsonb not null default '[]'::jsonb,
  -- What the public page calls "Snapshot taken ...".
  synced_at timestamptz not null default now()
);

insert into public.library_catalogue_meta (id) values (true);

alter table public.library_catalogue_meta enable row level security;
revoke all on table public.library_catalogue_meta from anon, authenticated;
grant select, insert, update on table public.library_catalogue_meta to service_role;

-- ---------------------------------------------------------------------------
-- A copy of a game that is not in the building cannot be lent
-- ---------------------------------------------------------------------------

-- Unchanged from 20260902160000 except for the shelf_status condition. Copies
-- of an off-shelf title keep their rows and their loan history; they simply
-- stop being reachable, so taking a game off the shelf is one flag rather than
-- a cascade through circulation.
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

  closes := library_closes_at(ed_id);
  if closes is not null and now() > closes - make_interval(mins => library_last_call_minutes()) then
    raise exception 'library_last_call';
  end if;

  if exists (
    select 1 from library_loans
     where attendee_id = p_attendee_id and status in ('requested', 'checked_out')
  ) then
    raise exception 'already_holding';
  end if;

  select c.id as cid, c.copy_number as cnum
    into chosen
    from library_copies c
    join library_titles t on t.id = c.title_id
   where t.key = p_title_key
     and t.shelf_status = 'on_shelf'
     and c.status = 'available'
     and not exists (
       select 1 from library_loans l
        where l.copy_id = c.id and l.status in ('requested', 'checked_out')
     )
   order by c.copy_number
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

-- ---------------------------------------------------------------------------
-- What the attendee app greys out
-- ---------------------------------------------------------------------------

-- Two things at once, and the second is the reason this is here.
--
-- 1. This function was live in the database but had no definition in
--    supabase/migrations/ -- it was created outside the migration history, so
--    a database rebuilt from this directory would not have had it and
--    GET /api/app/library would have failed. Recording it here closes that.
--
-- 2. It now also reports off-shelf titles. The attendee app bundles the
--    catalogue as a static chunk so the library works on venue wifi, which
--    means a game taken off the shelf today is still listed by every phone
--    running yesterday's bundle. Adding it here makes that stale listing
--    *safe*: the game shows greyed out rather than offering a box that is not
--    in the building. The alternative -- making the app fetch its catalogue
--    live -- would trade a cosmetic staleness for an empty library screen the
--    first time somebody opens the app out of signal.
create or replace function public.library_unavailable_keys()
returns setof text
language sql
stable
set search_path = public
as $$
  select t.key
    from library_titles t
   where t.shelf_status = 'off_shelf'
      or not exists (
     select 1
       from library_copies c
      where c.title_id = t.id
        and c.status = 'available'
        and not exists (
          select 1 from library_loans l
           where l.copy_id = c.id
             and (l.status = 'checked_out'
                  or (l.status = 'requested' and l.request_expires_at > now()))
        )
   );
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

alter table public.library_title_aliases enable row level security;

-- Same posture as the tables it serves: nothing reaches it but the Worker. The
-- public catalogue is published through GET /api/catalogue rather than by
-- opening these tables to anon, so the site and the attendee app read one
-- shape and the circulation tables stay shut.
revoke all on table public.library_title_aliases from anon, authenticated;
grant select, insert, update, delete on table public.library_title_aliases to service_role;
revoke truncate on table public.library_title_aliases from service_role;
