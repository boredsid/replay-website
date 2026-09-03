-- Sponsor logo uploads
--
-- The homepage logo wall used to be a folder of files committed to the repo.
-- Admins now upload artwork from the console instead, so a sponsor row needs
-- to remember which storage object its logo came from (to replace or delete
-- it) and when it last changed.
--
-- `logo_url` already exists and stays the public address the site reads.
-- `logo_path` is the object key inside the bucket; it is null for rows whose
-- logo is hosted elsewhere (a sponsor's own CDN, say), and only rows that own
-- an object may delete one.

alter table sponsors
  add column if not exists logo_path text,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_sponsors_updated on sponsors;
create trigger trg_sponsors_updated before update on sponsors
  for each row execute function set_updated_at();

-- Public bucket: the site build downloads each logo over the anonymous
-- `/object/public/` route and rasterises it into a normalised tile, and the
-- admin console previews the same URL. Writes never happen from a browser —
-- the worker uploads with the service role, which bypasses storage RLS — so
-- the bucket needs no object policies of its own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sponsor-logos',
  'sponsor-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
