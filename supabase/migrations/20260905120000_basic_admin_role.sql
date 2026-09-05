-- A rung between "runs one desk" and "can change who runs the desks".
--
-- `basic_admin` reaches everything a full admin does except the staff table.
-- The distinction that matters is not what somebody can see but whether they
-- can grant themselves more: a role that can edit the staff list is a role that
-- can make itself anything, so there is really only one privilege boundary in
-- this system and it runs around /api/admin/staff.
alter table public.staff drop constraint staff_roles_known;
alter table public.staff add constraint staff_roles_known check (
  roles <@ array['admin', 'basic_admin', 'check_in', 'library', 'programme']::text[]
);

-- The last-admin guard deliberately still counts only `admin`.
--
-- basic_admin cannot reach the staff table, so a room full of them and no full
-- admin is a room nobody can be added to or removed from without a deploy --
-- which is the lockout this trigger exists to prevent.
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

  if tg_op = 'UPDATE' and 'admin' = any(new.roles) then
    return new;
  end if;

  if 'admin' = any(old.roles) and admins_left = 0 then
    raise exception 'last_admin';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;
