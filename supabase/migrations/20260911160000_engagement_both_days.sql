-- A community engagement can now run on both days, not only one.
--
-- An engagement is priced per day, so a partner running their activity on
-- Saturday and Sunday is simply sold two days. The admin decides that when
-- they set up the partner; the partner's own link can still move a one-day
-- engagement between days, but cannot turn one day into two or back.
--
-- Only the engagement branch changes. Booths and sponsorships still have to
-- cover the whole weekend, and a lead may still carry no days at all.

alter table public.partners
  drop constraint partners_days_match;

alter table public.partners
  add constraint partners_days_match check (
    (submitted_at is null and cardinality(days) = 0)
    or
    (
      package_key in ('standard_engagement', 'patron_engagement')
      and (
        cardinality(days) = 1
        or (cardinality(days) = 2 and days @> array['day1', 'day2']::text[])
      )
    )
    or
    (
      package_key not in ('standard_engagement', 'patron_engagement')
      and cardinality(days) = 2
      and days @> array['day1', 'day2']::text[]
    )
  );
