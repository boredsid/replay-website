-- Story games join the programme's activity types.
--
-- A story game is a narrative tabletop session — collaborative storytelling
-- with light or no GM prep — so it sits beside `ttrpg` rather than inside it:
-- organisers need to tell the two apart when they plan tables and when
-- attendees filter the schedule.
--
-- `kind` is a check constraint rather than an enum, so widening it means
-- replacing the constraint with the full list. Keep this list in step with
-- `ScheduleKind` (site and admin), `KINDS` in the Worker's schedule handler,
-- and the label/pill maps in `ScheduleDay.astro`.

alter table public.schedule_items
  drop constraint if exists schedule_items_kind_check;

alter table public.schedule_items
  add constraint schedule_items_kind_check
    check (kind in (
      'workshop', 'tournament', 'open-play', 'meal', 'talk', 'ttrpg',
      'story-game', 'puzzle', 'quiz', 'social-game', 'playtest',
      'publisher-showcase', 'booth', 'food', 'merch', 'amenity', 'special'
    ));
