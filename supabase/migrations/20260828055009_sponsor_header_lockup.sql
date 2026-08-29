-- Which sponsor logos join the header lockup
--
-- The site header renders “X presents REPLAY in association with Y” from the
-- sponsors holding the `title` and `association` tiers. Holding the tier and
-- being ready to appear in the lockup are not the same moment: artwork gets
-- uploaded while a deal is still being papered, and a logo in the header is
-- the most public place it can land. This column is the console's switch for
-- that, read only for those two tiers — every other tier ignores it, and the
-- logo wall ignores it entirely.
--
-- Default true because the tier itself sells the lockup (see
-- `src/lib/sponsor-tiers.ts`): the switch is there to hold a credit back, not
-- to have to remember to turn one on. Existing rows therefore keep behaving
-- exactly as they do today.
--
-- Like everything else the wall reads, this reaches replaycon.in only at the
-- next site build.

alter table sponsors add column show_in_header boolean not null default true;

comment on column sponsors.show_in_header is
  'Include this sponsor in the site header lockup. Read only for the title and association tiers.';
