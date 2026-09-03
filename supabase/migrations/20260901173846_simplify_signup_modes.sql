-- Reduce sign-up modes to the two that mean something.
--
-- 'walk-in', 'advance' and 'on-site' were descriptive labels the public site
-- printed beside a session. Nothing in production ever used them: all 62 items
-- on replay-3 are 'none', and no item has ever had a signup_url. They survived
-- as four dropdown options that did nothing, next to the one that does.
--
-- What is left is a real distinction: either a session takes bookings in the
-- app, or it does not.

-- Nothing to migrate -- every existing row is already 'none' -- but do it
-- defensively rather than trusting a count taken at one moment.
update public.schedule_items
   set signup_mode = 'none'
 where signup_mode not in ('none', 'app');

alter table public.schedule_items
  drop constraint schedule_items_signup_mode_check;
alter table public.schedule_items
  add constraint schedule_items_signup_mode_check
    check (signup_mode in ('none', 'app'));

-- signup_url only ever existed to accompany 'advance' and 'on-site'. With those
-- gone it has no meaning, and no row has ever carried a value.
alter table public.schedule_items
  drop constraint if exists schedule_items_signup_url_check;
alter table public.schedule_items
  drop column signup_url;
