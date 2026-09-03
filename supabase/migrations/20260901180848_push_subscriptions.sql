-- Push subscriptions, one row per browser that agreed to be notified.
--
-- Push is strictly opt-in and asked for at the moment of value -- joining a
-- waitlist -- never on first load. The three category flags exist because
-- wanting to hear that a seat opened is not the same as wanting every
-- announcement, and a single on/off switch would force that choice.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,

  -- The push service's URL for this browser. Unique because re-subscribing the
  -- same browser must update the existing row rather than accumulate duplicates
  -- that would each deliver the same notification.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,

  wants_waitlist boolean not null default true,
  wants_announcements boolean not null default true,
  wants_reminders boolean not null default true,

  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0,
  -- Set when the push service reports the subscription gone (404/410), or when
  -- the attendee turns notifications off.
  revoked_at timestamptz
);

create index push_subscriptions_live
  on public.push_subscriptions (attendee_id)
  where revoked_at is null;

create index push_subscriptions_edition
  on public.push_subscriptions (edition_id)
  where revoked_at is null;

alter table public.push_subscriptions enable row level security;

-- Browser roles reach none of it: an endpoint plus its keys is enough to send
-- someone notifications, so these rows are credential material.
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update on table public.push_subscriptions to service_role;
revoke delete, truncate on table public.push_subscriptions from service_role;

-- Session reminders run from a cron trigger, and cron delivery is at-least-once.
-- This stamp is what stops a retry reminding everybody a second time.
alter table public.session_signups
  add column reminded_at timestamptz;
