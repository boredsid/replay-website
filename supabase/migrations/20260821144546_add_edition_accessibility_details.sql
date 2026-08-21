-- Edition-specific accessibility guidance for the public Plan Your Visit page.

alter table public.editions
  add column accessibility_details text,
  add constraint editions_accessibility_details_length
    check (accessibility_details is null or char_length(accessibility_details) <= 2000);

comment on column public.editions.accessibility_details is
  'Public venue accessibility, sensory, seating, toilet, and accommodation guidance for the edition.';
