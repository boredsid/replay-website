-- The dashboard's break-even estimate averages income over tickets sold, and a
-- desk entry (source.manual) is not a sale at that average: it is usually a comp
-- or a hand-typed row at ₹0, which drags the average down and inflates the count
-- of registrations still needed. Carry `source` in the snapshot so the Worker can
-- tell the two apart. Everything else about the function is unchanged.
create or replace function public.finance_snapshot(p_edition_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'edition', (select jsonb_build_object('id', id, 'slug', slug, 'name', name, 'pricing', pricing,
    'capacity_per_day', capacity_per_day, 'start_date', start_date, 'end_date', end_date)
    from public.editions where id = p_edition_id),
  'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
    'staff_email', a.staff_email, 'automatic_income', a.automatic_income,
    'active', coalesce(s.roles && array['admin', 'basic_admin']::text[], false)) order by a.name), '[]'::jsonb)
    from public.finance_accounts a left join public.staff s on s.email = a.staff_email),
  'registrations', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at,
    'payment_status', payment_status, 'amount_paid', amount_paid, 'discount_applied', discount_applied,
    'guild_tier_at_purchase', guild_tier_at_purchase, 'seats', seats, 'days', days, 'source', source)), '[]'::jsonb)
    from public.registrations where edition_id = p_edition_id),
  'partners', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at,
    'organization_name', organization_name, 'payment_status', payment_status,
    'total_amount', total_amount, 'gst_amount', gst_amount)), '[]'::jsonb)
    from public.partners where edition_id = p_edition_id),
  'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by entry_date desc, created_at desc), '[]'::jsonb)
    from public.finance_entries e where edition_id = p_edition_id)
);
$$;
revoke all on function public.finance_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.finance_snapshot(uuid) to service_role;
