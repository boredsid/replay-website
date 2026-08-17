-- Resolve the actionable Supabase security and performance advisor findings.

-- This trigger helper only needs pg_catalog functions and is never called by
-- application clients. Pin its lookup path and remove Data API execution.
alter function public.set_updated_at() set search_path = pg_catalog;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Supabase's automatic-RLS event trigger must continue to run for DDL, but it
-- must not be exposed as an RPC to anonymous or signed-in API clients.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Postgres does not automatically index foreign-key columns. This supports
-- user lookups and ON UPDATE CASCADE for orders.user_phone.
create index orders_user_phone on public.orders (user_phone);
