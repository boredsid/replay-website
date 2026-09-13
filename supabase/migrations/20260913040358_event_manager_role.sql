-- A role scoped to named sessions rather than to a page.
--
-- Every role so far answers "which desk do you work", and each of them carries
-- the shared read-only floor — the programme, the notices, the bookings — on
-- top of whatever it owns. That is right for somebody running a desk all
-- weekend and wrong for the person who has volunteered to run one tournament:
-- giving them the events board today means giving them every booking in the
-- edition, plus the ticket list, to change the four rows that are theirs.
--
-- `event_manager` is the first role whose grant is rows, not pages. It reaches
-- the events board and nothing else — deliberately not even the read-only floor
-- — and on that board it sees and changes only the sessions an admin has named
-- here. An event manager with no rows in this table can do nothing, which is
-- the safe direction: the assignment is the grant.
alter table public.staff drop constraint staff_roles_known;
alter table public.staff add constraint staff_roles_known check (
  roles <@ array['admin', 'basic_admin', 'read_only', 'check_in', 'library', 'programme', 'event_manager']::text[]
);

create table public.staff_events (
  -- Cascades both ways on purpose. Removing somebody from staff must not leave
  -- their assignments behind to be inherited by the next person given that
  -- address, and deleting a session must not leave a grant pointing at nothing.
  staff_email text not null references public.staff(email) on delete cascade on update cascade,
  schedule_item_id uuid not null references public.schedule_items(id) on delete cascade,
  assigned_by text,
  created_at timestamptz not null default now(),
  primary key (staff_email, schedule_item_id)
);

-- The lookup this table exists for: "which sessions are this person's", run
-- once per request they make to the events board.
create index staff_events_by_email on public.staff_events (staff_email);

alter table public.staff_events enable row level security;

-- Same reasoning as `staff` itself: nothing reaches this but the Worker, after
-- it has verified an Access JWT. A browser role holding it would be a browser
-- role that could widen its own grant.
revoke all on table public.staff_events from anon, authenticated;
grant select, insert, update, delete on table public.staff_events to service_role;
revoke truncate on table public.staff_events from service_role;

-- The last-admin guard is untouched: it counts `admin` only, and an event
-- manager can no more reach the staff table than a desk role can.
