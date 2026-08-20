-- Store one scalar price for any single-day pass. The previous JSON shape
-- duplicated that value under day1/day2, allowing accidental price drift.

do $$
begin
  if exists (
    select 1
    from public.editions e
    where (
      jsonb_typeof(e.pricing -> 'oneshot') is distinct from 'number'
      and jsonb_typeof(e.pricing -> 'oneshot') is distinct from 'object'
    )
    or (
      jsonb_typeof(e.pricing -> 'oneshot') = 'object'
      and jsonb_typeof(e.pricing -> 'oneshot' -> 'day1') is distinct from 'number'
    )
  ) then
    raise exception 'edition pricing has an invalid oneshot value';
  end if;

  if exists (
    select 1
    from public.editions e
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(e.pricing -> 'oneshot') = 'object' then e.pricing -> 'oneshot'
        else '{}'::jsonb
      end
    ) as day_price(day_key, amount)
    where jsonb_typeof(e.pricing -> 'oneshot') = 'object'
      and (
        jsonb_typeof(e.pricing -> 'oneshot' -> 'day1') is distinct from 'number'
        or jsonb_typeof(day_price.amount) is distinct from 'number'
        or day_price.amount <> e.pricing -> 'oneshot' -> 'day1'
      )
  ) then
    raise exception 'cannot collapse differing per-day edition prices';
  end if;
end
$$;

update public.editions
set pricing = jsonb_set(pricing, '{oneshot}', pricing -> 'oneshot' -> 'day1', false)
where jsonb_typeof(pricing -> 'oneshot') = 'object';

alter table public.editions
  add constraint editions_pricing_shape
  check (
    jsonb_typeof(pricing) = 'object'
    and jsonb_typeof(pricing -> 'oneshot') = 'number'
    and (pricing ->> 'oneshot')::numeric >= 0
    and pricing ? 'campaign'
    and (
      pricing -> 'campaign' = 'null'::jsonb
      or (
        jsonb_typeof(pricing -> 'campaign') = 'number'
        and (pricing ->> 'campaign')::numeric >= 0
      )
    )
    and (
      registration_status = 'closed'
      or jsonb_typeof(pricing -> 'campaign') = 'number'
    )
    and (
      not (pricing ? 'adventurer_cap')
      or (
        jsonb_typeof(pricing -> 'adventurer_cap') = 'number'
        and (pricing ->> 'adventurer_cap')::numeric >= 0
      )
    )
  );
