-- Supabase's default privileges grant service_role every privilege on new
-- tables in public, so the `grant select, insert` in the check_in_events
-- migration did not restrict anything. This is what actually makes the event
-- log append-only: history cannot be rewritten even by a bug in the Worker.
revoke update, delete, truncate on table public.check_in_events from service_role;
