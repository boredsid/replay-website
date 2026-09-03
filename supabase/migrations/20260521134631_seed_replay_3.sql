-- Seeds the REPLAY 3 edition row. Recovered from the ledger's recorded
-- statement; it existed only in the database until now.
--
-- DO NOT re-run this against a live database. The `on conflict do update`
-- overwrites name, dates, venue, capacity and pricing with the values frozen
-- here on 21 May 2026 -- when the venue was still 'TBD' and the pricing was a
-- guess. It is harmless where it belongs, seeding a fresh or local database,
-- and destructive anywhere the edition has since been edited. It is already
-- recorded as applied on production, so a push will skip it.
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
  '{"oneshot": {"day1": 800, "day2": 800}, "campaign": 1400, "adventurer_cap": 1000}'::jsonb,
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
