-- What to call each owner in the admin catalogue.
--
-- A BoardGameGeek collection is named after its owner's BGG username
-- ("Vinto100"), which is not what anybody calls them at the desk. This maps a
-- source name onto the person's name, and sync:library applies it before
-- writing `library_title_owners`, so the console shows "Movin".
--
-- The rows are deliberately NOT in this migration. The repository is public,
-- and a committed "this handle is this person" is exactly the link the library
-- page is built never to make. They live only in the database; add or change
-- one with SQL through the Supabase MCP:
--
--   insert into public.library_owner_names (source_name, display_name)
--   values ('SomeBggUser', 'Name')
--   on conflict (source_name) do update set display_name = excluded.display_name;
--
-- then rename that owner's existing rows in `library_title_owners` (or wait
-- for the next sync, which rewrites them).

create table public.library_owner_names (
  -- As the source spells it: a `src/data/bgg/*.tsv` filename stem, or a BGC
  -- `owned_by` value.
  source_name text primary key check (length(trim(source_name)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.library_owner_names enable row level security;
revoke all on table public.library_owner_names from anon, authenticated;
grant select, insert, update, delete on table public.library_owner_names to service_role;
revoke truncate on table public.library_owner_names from service_role;
