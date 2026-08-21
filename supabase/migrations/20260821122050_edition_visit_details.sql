-- Edition-specific practical information for the public Plan Your Visit page.
-- Nullable fields let organisers publish confirmed details incrementally.

alter table public.editions
  add column venue_address text,
  add column google_maps_url text,
  add column entrance_details text,
  add column check_in_location text,
  add column nearest_metro_name text,
  add column nearest_metro_distance text,
  add column nearest_bus_stop_name text,
  add column nearest_bus_stop_distance text,
  add column parking_availability text,
  add column parking_charges text,
  add column food_details text,
  add column water_details text,
  add column game_library_process text,
  add column help_on_the_day text,
  add constraint editions_google_maps_url_https
    check (google_maps_url is null or google_maps_url ~ '^https://'),
  add constraint editions_visit_details_lengths
    check (
      (venue_address is null or char_length(venue_address) <= 500)
      and (google_maps_url is null or char_length(google_maps_url) <= 500)
      and (entrance_details is null or char_length(entrance_details) <= 2000)
      and (check_in_location is null or char_length(check_in_location) <= 500)
      and (nearest_metro_name is null or char_length(nearest_metro_name) <= 160)
      and (nearest_metro_distance is null or char_length(nearest_metro_distance) <= 120)
      and (nearest_bus_stop_name is null or char_length(nearest_bus_stop_name) <= 160)
      and (nearest_bus_stop_distance is null or char_length(nearest_bus_stop_distance) <= 120)
      and (parking_availability is null or char_length(parking_availability) <= 1000)
      and (parking_charges is null or char_length(parking_charges) <= 500)
      and (food_details is null or char_length(food_details) <= 2000)
      and (water_details is null or char_length(water_details) <= 1000)
      and (game_library_process is null or char_length(game_library_process) <= 3000)
      and (help_on_the_day is null or char_length(help_on_the_day) <= 2000)
    );

comment on column public.editions.google_maps_url is
  'Public HTTPS Google Maps pin for the edition venue.';
