-- Who may do what in the admin, as rows rather than an environment variable.
--
-- Authorisation used to be one bit: `ADMIN_EMAILS.includes(email)`, guarding all
-- fifty-two admin routes. With a handful of people who all knew each other that
-- was coarse but honest. With ten volunteers it stops being either — somebody
-- added to work the check-in desk can also delete announcements, rewrite ticket
-- pricing and read every attendee's phone number, not because anyone decided
-- that but because there was no way to say anything narrower.
--
-- Adding somebody also meant editing a Worker secret and redeploying, which is
-- not a thing to do from a venue on a Saturday.
--
-- Roles are an array, not a single value. At this size people cover more than
-- one desk: the same volunteer works check-in in the morning and the library
-- after lunch, and making that two accounts would be worse than useless.

create table public.staff (
  -- The email from the verified Cloudflare Access JWT, lowercased. Access
  -- proves who somebody is; this table decides what they may do.
  email text primary key,
  name text,
  roles text[] not null default '{}',
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_email_lowercase check (email = lower(email)),
  constraint staff_email_shaped check (email like '%_@_%._%'),
  -- An empty array is somebody who can sign in and do nothing, which is a
  -- confusing way to express "removed". Removal is a delete.
  constraint staff_has_a_role check (cardinality(roles) > 0),
  constraint staff_roles_known check (
    roles <@ array['admin', 'check_in', 'library', 'programme']::text[]
  )
);

create trigger trg_staff_updated
before update on public.staff
for each row execute function public.set_updated_at();

/**
 * Refuses to remove the last way back in.
 *
 * The staff table is the only authority now, so an empty table — or one with
 * nobody able to edit it — locks everybody out of their own event with no fix
 * short of a Worker deploy. A trigger rather than application code, because
 * this must hold whichever caller is wrong.
 */
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  admins_left int;
begin
  select count(*) into admins_left
    from staff
   where 'admin' = any(roles)
     and email <> coalesce(old.email, '');

  -- On update the row may still be an admin afterwards, in which case nothing
  -- was lost.
  if tg_op = 'UPDATE' and 'admin' = any(new.roles) then
    return new;
  end if;

  if 'admin' = any(old.roles) and admins_left = 0 then
    raise exception 'last_admin';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger trg_staff_protect_last_admin
before update or delete on public.staff
for each row execute function public.protect_last_admin();

alter table public.staff enable row level security;

-- Nothing reaches this except the Worker, which reads it after verifying an
-- Access JWT. A browser role holding it would be a browser role that could
-- grant itself admin.
revoke all on table public.staff from anon, authenticated;
grant select, insert, update, delete on table public.staff to service_role;
revoke truncate on table public.staff from service_role;

-- The first admin, so the table is never empty and the door is never shut.
-- Anyone else previously in ADMIN_EMAILS is added back through the admin app,
-- which is the point of this table existing.
insert into public.staff (email, name, roles, added_by)
values ('siddhantnarula96@gmail.com', 'Siddhant Narula', array['admin'], 'migration')
on conflict (email) do update set roles = array['admin'];
