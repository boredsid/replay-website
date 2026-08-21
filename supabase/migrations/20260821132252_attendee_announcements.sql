-- Organiser-authored, time-boxed notices for the attendee app.
--
-- Public clients never read this table directly. Cloudflare Access protects
-- the admin API, and the Worker exposes only published notices whose delivery
-- window is active. Keeping direct browser roles out also prevents drafts from
-- being discoverable through the Data API.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  title text not null,
  body text not null,
  severity text not null default 'info'
    check (severity in ('info', 'urgent', 'incident')),
  audience text not null default 'all'
    check (audience in ('all', 'day1', 'day2')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length
    check (char_length(btrim(title)) between 1 and 120),
  constraint announcements_body_length
    check (char_length(btrim(body)) between 1 and 2000),
  constraint announcements_delivery_window
    check (ends_at is null or ends_at > starts_at)
);

create index announcements_edition_delivery
  on public.announcements (edition_id, is_published, starts_at, ends_at);

create index announcements_active_published
  on public.announcements (edition_id, severity, starts_at desc)
  where is_published = true;

create trigger trg_announcements_updated
before update on public.announcements
for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

-- Grants decide whether a Data API role can reach the table; RLS then limits
-- rows. The Worker is the sole application reader/writer and uses the service
-- role only on the server.
revoke all on table public.announcements from anon, authenticated;
grant select, insert, update, delete on table public.announcements to service_role;
