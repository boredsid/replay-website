-- A role for somebody who needs to see the day, not run it.
--
-- Every desk role already carries read-only access to the programme, the
-- notices, the bookings and now the events board — that access was added for
-- volunteers, not as a role in its own right, so the only way to give it to
-- somebody was to hand them a desk they do not work. Which is how a person who
-- wanted to watch the schedule ended up able to check people in.
--
-- `read_only` is exactly that shared floor and nothing on top of it. It is the
-- one role that grants no write anywhere, so it is also the safe default for a
-- new volunteer before anyone decides which desk they are on.
alter table public.staff drop constraint staff_roles_known;
alter table public.staff add constraint staff_roles_known check (
  roles <@ array['admin', 'basic_admin', 'read_only', 'check_in', 'library', 'programme']::text[]
);

-- The last-admin guard is untouched on purpose: it counts `admin` only, and
-- `read_only` cannot reach the staff table any more than a desk role can.
