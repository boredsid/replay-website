-- Starred sessions, server-side, so they can be reminded about.
--
-- My Day has always been a local list: `replay:my-day:v1` in localStorage, which
-- makes it work for someone who never pairs and never checks in. That is worth
-- keeping. But a list only the phone knows about cannot be reminded about by a
-- cron, and a star is exactly the signal "I mean to be at this" — the one thing
-- an attendee most wants a nudge for.
--
-- So a paired attendee's stars are mirrored here. The local list stays the
-- source for anyone unpaired and the offline cache for everyone; this table is
-- what the reminder job reads.
--
-- Unlike a sign-up, a star holds nothing scarce. There is no capacity, no queue,
-- and so no reason to keep a tombstone row: unstarring deletes. That also keeps
-- the table honest about its one job — everything in it is something somebody
-- currently wants to be reminded about.
create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  schedule_item_id uuid not null references public.schedule_items(id) on delete cascade,
  saved_at timestamptz not null default now(),
  -- Same guard as session_signups.reminded_at: cron delivery is at-least-once.
  reminded_at timestamptz
);

-- Starring twice is the same as starring once. The app fires on every tap and
-- must not care whether an earlier tap already landed.
create unique index saved_items_one_per_person
  on public.saved_items (attendee_id, schedule_item_id);

-- The reminder job asks "who starred this session", once per due session.
create index saved_items_session on public.saved_items (schedule_item_id)
  where reminded_at is null;

create index saved_items_attendee on public.saved_items (attendee_id);

alter table public.saved_items enable row level security;

-- No policies: nothing reaches this table except the Worker, which authorises
-- every request against a device token and scopes it to one attendee.
revoke all on table public.saved_items from anon, authenticated;

-- Delete is granted here, unlike on push_subscriptions or check_in_events,
-- because unstarring is a real deletion rather than a state change. Truncate
-- still is not: losing the whole table silently is never a legitimate outcome.
grant select, insert, update, delete on table public.saved_items to service_role;
revoke truncate on table public.saved_items from service_role;
