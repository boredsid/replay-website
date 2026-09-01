-- Attendee identity: pairing codes, device tokens, and the QR handle.
--
-- Three secrets with three different jobs, kept apart on purpose:
--
--   pairing code   3 minutes, single use   exchanged once for a device token
--   device token   the event + a day       that attendee's own sign-ups and loans
--   QR token       the event, rotatable    NOTHING on its own -- a staff lookup handle
--
-- The QR is the one worth being precise about. It resolves only through an
-- Access-authenticated admin endpoint, so the privilege comes from the staff
-- session rather than from holding the QR. A photographed QR grants an attacker
-- nothing unless they are also a signed-in admin, and the payload carries no
-- name, phone, registration id, or edition -- it is opaque by inspection.
--
-- All three are stored only as SHA-256 hashes, so a database leak yields nothing
-- live. The plaintext is returned exactly once, at the moment it is minted.

create table public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  issued_by text not null,
  created_at timestamptz not null default now()
);

-- At most one outstanding code per attendee. Issuing a fresh one consumes the
-- previous, so a code read out across a busy desk cannot still be live an hour
-- later.
create unique index pairing_codes_one_outstanding
  on public.pairing_codes (attendee_id)
  where consumed_at is null;

create index pairing_codes_lookup on public.pairing_codes (code_hash) where consumed_at is null;

create table public.attendee_devices (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text
);

-- No user agent or device fingerprint is stored: it would be a personal-data
-- liability for no operational gain. Re-pairing at the desk revokes the old row.
create index attendee_devices_live
  on public.attendee_devices (attendee_id)
  where revoked_at is null;

create table public.attendee_credentials (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  qr_token_hash text not null unique,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);

-- One live QR per person, not per ticket. Three friends on one registration can
-- each have a different game out, and the loan has to name the right human.
create unique index attendee_credentials_one_live
  on public.attendee_credentials (attendee_id)
  where revoked_at is null;

alter table public.pairing_codes enable row level security;
alter table public.attendee_devices enable row level security;
alter table public.attendee_credentials enable row level security;

-- Browser roles reach none of this. The Worker is the sole reader and writer and
-- uses the service role only on the server; these rows are credential material,
-- so a Data API grant would defeat the point of hashing them.
revoke all on table public.pairing_codes from anon, authenticated;
revoke all on table public.attendee_devices from anon, authenticated;
revoke all on table public.attendee_credentials from anon, authenticated;

grant select, insert, update on table public.pairing_codes to service_role;
grant select, insert, update on table public.attendee_devices to service_role;
grant select, insert, update on table public.attendee_credentials to service_role;

-- Nothing here is ever deleted: a consumed code, a revoked device, and a retired
-- QR are all part of the record of who could do what and when. Supabase's default
-- privileges grant service_role everything on new public tables, so -- as with
-- check_in_events -- the revoke is what actually enforces that.
revoke delete, truncate on table public.pairing_codes from service_role;
revoke delete, truncate on table public.attendee_devices from service_role;
revoke delete, truncate on table public.attendee_credentials from service_role;
