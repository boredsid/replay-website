-- Phase 3B: relax single-current rule; allow phone edits to cascade.

-- 1. Multiple editions may be is_current; site resolves "current" as the
--    published edition with the latest start_date (see worker getCurrentEdition).
drop index if exists editions_only_one_current;

-- 2. Allow a user's phone (PK) to change and cascade to child rows.
alter table registrations drop constraint registrations_user_phone_fkey;
alter table registrations
  add constraint registrations_user_phone_fkey
  foreign key (user_phone) references users(phone)
  on update cascade on delete restrict;

alter table orders drop constraint orders_user_phone_fkey;
alter table orders
  add constraint orders_user_phone_fkey
  foreign key (user_phone) references users(phone)
  on update cascade on delete restrict;

-- 3. admin_audit_log.target_id holds non-uuid targets too (e.g. users.phone),
--    so widen it to text. Existing uuid values cast cleanly to text.
alter table admin_audit_log alter column target_id type text using target_id::text;
