-- Records `library_open_loans`, which was live but unversioned.
--
-- This changes nothing. The function already exists in the database and has
-- since the library desk shipped; what it did not have was a definition in this
-- directory. It was created straight against the database rather than through a
-- migration, so the repo has been quietly incomplete ever since.
--
-- That matters the moment anybody builds this schema from these files instead
-- of using the existing database -- a local Supabase, a staging project, a
-- branch, or a restore that replays migrations. In that database the desk's
-- "who has what out" screen would 500 the first time somebody opened it at the
-- counter, because `worker/src/admin/library.ts` calls an RPC that was never
-- created. Silent until used, which is the bad kind.
--
-- Found while recording `library_unavailable_keys` in
-- 20260909120000_library_catalogue.sql, which had drifted the same way. A diff
-- of the live database against this directory afterwards showed those two
-- functions and nothing else: 34 of 36 functions, and all 29 triggers and 4
-- policies, were already here. So this is one build's worth of drift, not a
-- systemic gap -- but it is worth re-running that check occasionally, and worth
-- preferring a migration over a direct `create function` when adding one.
--
-- The body below is copied verbatim from the live definition
-- (`pg_get_functiondef`), so applying this is a no-op.
--
-- `anon` and `authenticated` may execute it, which is Supabase's default for a
-- new function rather than a decision. It is safe: the function is SECURITY
-- INVOKER, and every table it reads is revoked from those roles, so a caller
-- who is not the Worker gets a permission error on the first join.

create or replace function public.library_open_loans()
returns table (
  loan_id uuid,
  attendee_id uuid,
  attendee_name text,
  contact_phone text,
  contact_is_purchaser boolean,
  title text,
  title_key text,
  copy_number integer,
  checked_out_at timestamptz,
  due_at timestamptz,
  overdue boolean,
  minutes_remaining integer
)
language sql
stable
set search_path = public
as $$
  select
    l.id,
    a.id,
    coalesce(a.display_name, 'Guest ' || a.seat_index),
    coalesce(a.phone, r.user_phone),
    (a.phone is null and r.user_phone is not null),
    t.title,
    t.key,
    c.copy_number,
    l.checked_out_at,
    l.due_at,
    (l.due_at <= now()),
    (extract(epoch from (l.due_at - now())) / 60)::int
  from library_loans l
  join attendees a on a.id = l.attendee_id
  left join registrations r on r.id = a.registration_id
  join library_copies c on c.id = l.copy_id
  join library_titles t on t.id = c.title_id
 where l.status = 'checked_out'
 order by l.due_at;
$$;
