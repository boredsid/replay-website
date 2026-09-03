-- Counting failures one row at a time made the fan-out's subrequest cost depend
-- on how many sends failed, which is exactly the moment it must not spike. One
-- call increments them all.
create or replace function public.bump_push_failures(p_ids uuid[])
returns void
language sql
set search_path = public
as $$
  update push_subscriptions
     set failure_count = failure_count + 1
   where id = any(p_ids);
$$;
