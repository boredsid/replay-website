-- supabase/seeds/replay-1-2.sql
-- Seeds the two historical REPLAY editions. Idempotent — safe to re-run.
-- replay-1: Jan 31 2026, single day, The Bangalore Local Koramangala, 50 seats, ₹800.
-- replay-2: Apr 18-19 2026, two day, same venue, 150 seats/day, ₹800/day or ₹1400 campaign.
-- Both ₹ totals include ₹200/day F&B cover at the venue.

insert into editions (
  slug, name, start_date, end_date, venue,
  capacity_per_day, pricing,
  registration_status, is_current, is_published
) values
(
  'replay-1',
  'REPLAY 1',
  '2026-01-31', '2026-01-31',
  'The Bangalore Local, Koramangala',
  '{"day1": 50}'::jsonb,
  '{"oneshot": 800, "campaign": null, "adventurer_cap": 1000}'::jsonb,
  'closed', false, true
),
(
  'replay-2',
  'REPLAY 2',
  '2026-04-18', '2026-04-19',
  'The Bangalore Local, Koramangala',
  '{"day1": 150, "day2": 150}'::jsonb,
  '{"oneshot": 800, "campaign": 1400, "adventurer_cap": 1000}'::jsonb,
  'closed', false, true
)
on conflict (slug) do update set
  name             = excluded.name,
  start_date       = excluded.start_date,
  end_date         = excluded.end_date,
  venue            = excluded.venue,
  capacity_per_day = excluded.capacity_per_day,
  pricing          = excluded.pricing;
-- registration_status / is_current / is_published intentionally NOT overwritten.
