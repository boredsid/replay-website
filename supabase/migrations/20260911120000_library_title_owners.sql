-- Who lends each game, so the admin catalogue can be filtered by owner.
--
-- Until now the owner of a box never reached this database. sync:library knew
-- it -- one BoardGameGeek collection per person, and the BGC sheet's
-- `owned_by` -- and collapsed it to a bare copy count before writing, because
-- `library_titles` feeds GET /api/catalogue and the public page must never
-- carry lenders' names or handles.
--
-- That rule stands. The names get their own table rather than a column, so the
-- boundary is structural instead of resting on every public query naming its
-- columns: no public endpoint reads this table, and anon/authenticated cannot.
--
-- Per title, not per copy. The boxes are not physically labelled, so "copy 2 of
-- Catan is Siddhant's" would be a fiction; "Catan: Siddhant 1, Suranjana 1" is
-- what the sources actually say.
--
-- Owned by sync:library, which rewrites a title's rows on every run. A game
-- added by hand in the console has none, and lists as "No owner recorded".

create table public.library_title_owners (
  title_id uuid not null references public.library_titles(id) on delete cascade,
  -- As the source spells it: a BoardGameGeek username (the collection file's
  -- name) or the BGC sheet's `owned_by`, falling back to 'BGC'.
  owner text not null check (length(trim(owner)) > 0),
  copies int not null check (copies > 0),
  primary key (title_id, owner)
);

create index library_title_owners_owner on public.library_title_owners (owner);

alter table public.library_title_owners enable row level security;
revoke all on table public.library_title_owners from anon, authenticated;
-- `delete` is allowed here, unlike on titles and copies: a row is a derived
-- attribution the sync replaces wholesale, not a record anything points at.
grant select, insert, update, delete on table public.library_title_owners to service_role;
revoke truncate on table public.library_title_owners from service_role;
