-- A published notice and a delivered notice were the same event. They are not.
--
-- The push fired the moment `is_published` flipped, whatever `starts_at` said.
-- So a notice scheduled for 3pm and written at 11am buzzed every phone at 11am
-- while the in-app banner stayed hidden until 3pm -- the notification arriving
-- hours before the thing it announces, and no way to write one in advance.
--
-- Delivery now happens when the notice goes live, which for a scheduled one
-- means a cron tick rather than the request that wrote it. Cron delivery is
-- at-least-once, so this stamp is what stops a retry buzzing everybody twice.
-- It is the same mechanism as `session_signups.reminded_at`.
alter table public.announcements
  add column notified_at timestamptz,
  -- How many devices the fan-out actually reached. Null means never dispatched;
  -- zero means dispatched and nobody was reachable, which is the case the desk
  -- most needs to be able to tell apart from success.
  add column notified_sent int,
  add column notified_failed int;

-- The cron's query: published notices that have come due and not yet gone out.
-- Partial, because the rows it wants are a small and shrinking subset -- every
-- delivered notice leaves the index for good.
create index announcements_pending_dispatch
  on public.announcements (edition_id, starts_at)
  where is_published = true and notified_at is null;

-- Everything already published predates dispatch tracking. Stamping them as
-- delivered is what stops the first cron tick after this migration re-sending
-- every notice ever published, which during an event would be unforgivable.
update public.announcements
   set notified_at = coalesce(starts_at, created_at)
 where is_published = true
   and notified_at is null;
