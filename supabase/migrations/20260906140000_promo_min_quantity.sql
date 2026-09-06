-- Minimum ticket count for a promo code, so a campaign can be a bulk discount:
-- "GROUP5 takes 20% off, on five tickets or more".
--
-- The floor is on the booking's ticket count, not on its rupee value. A code
-- that only pays off above a certain spend is already expressible as a flat
-- discount with a `first_ticket` scope; what could not be said before was
-- "this only applies to a group", which is how the discount is actually sold.
--
-- Defaults to 1, which is the rule every existing code already follows, so the
-- backfill is the default itself and no row changes meaning.
alter table public.promo_codes
  add column min_quantity int not null default 1
    check (min_quantity > 0);
