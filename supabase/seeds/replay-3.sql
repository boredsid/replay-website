-- supabase/seeds/replay-3.sql
-- Seeds the REPLAY 3 edition. Idempotent — safe to re-run.
-- Sept 12-13, 2026. 250 seats per day. Pricing: ₹700/day oneshot, ₹1200 campaign.
-- Adventurer cap is ₹1000 (legacy parity).

insert into editions (
  slug, name, start_date, end_date, venue,
  capacity_per_day, pricing,
  registration_status, is_current, is_published
) values (
  'replay-3',
  'REPLAY 3',
  '2026-09-12', '2026-09-13',
  'TBD',
  '{"day1": 250, "day2": 250}'::jsonb,
  '{"oneshot": 700, "campaign": 1200, "adventurer_cap": 1000}'::jsonb,
  'upcoming',
  true,
  false
)
on conflict (slug) do update set
  name             = excluded.name,
  start_date       = excluded.start_date,
  end_date         = excluded.end_date,
  venue            = excluded.venue,
  capacity_per_day = excluded.capacity_per_day,
  pricing          = excluded.pricing;
-- registration_status / is_current / is_published intentionally NOT overwritten,
-- so a re-run never accidentally flips live flags.
