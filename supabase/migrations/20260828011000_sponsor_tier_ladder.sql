-- Sponsor tiers follow the sponsorship ladder, and the wall sorts itself
--
-- `sponsors.tier` carried the placeholder ladder the schema shipped with
-- (title / gold / silver / partner). The tiers REPLAY actually sells are the
-- ones in `src/lib/sponsor-tiers.ts` and `docs/SPONSORSHIP.md`, plus a
-- community partner for everyone credited on the wall without a package.
--
-- Existing data: every row is `partner` except one `silver`, none of which
-- carried a meaning worth preserving — they were all defaults from before the
-- ladder existed — so they land on `community`, the tier that reads the same
-- way. `gold` maps to `association` for the same reason the ladder replaced
-- it, though no row holds it.
--
-- `display_order` goes with it. Ordering a wall by hand is upkeep nobody was
-- going to do; the tier sets the rank and names sort alphabetically inside it.

alter table sponsors drop constraint sponsors_tier_check;

update sponsors set tier = case tier
  when 'title'   then 'title'
  when 'gold'    then 'association'
  when 'silver'  then 'community'
  when 'partner' then 'community'
  else 'community'
end;

alter table sponsors add constraint sponsors_tier_check
  check (tier in ('title', 'association', 'venue', 'zone', 'gaming', 'community'));

-- The index existed to serve `order by display_order`; both go together.
drop index if exists sponsors_edition_order;
alter table sponsors drop column if exists display_order;

create index sponsors_edition_tier on sponsors(edition_id, tier);
