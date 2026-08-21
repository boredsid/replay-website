export type AppTab = 'now' | 'schedule' | 'my-day' | 'map' | 'info';

/**
 * Organiser-authored practical guidance, mirroring `EditionVisitDetails` in the
 * public site's `src/lib/types.ts`. Every field is optional: organisers publish
 * them incrementally, and the app must say "pending" rather than guess.
 */
export interface EditionVisitDetails {
  venue_address?: string | null;
  google_maps_url?: string | null;
  entrance_details?: string | null;
  check_in_location?: string | null;
  nearest_metro_name?: string | null;
  nearest_metro_distance?: string | null;
  nearest_bus_stop_name?: string | null;
  nearest_bus_stop_distance?: string | null;
  parking_availability?: string | null;
  parking_charges?: string | null;
  food_details?: string | null;
  water_details?: string | null;
  accessibility_details?: string | null;
  game_library_process?: string | null;
  help_on_the_day?: string | null;
}

export interface EditionData extends EditionVisitDetails {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  venue: string;
}

export interface ScheduleItem {
  id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  description: string | null;
  location: string | null;
  kind: string;
  section: string;
  is_all_day: boolean;
  host_name: string | null;
  signup_mode: 'none' | 'walk-in' | 'advance' | 'on-site';
  signup_url: string | null;
  public_status: 'published' | 'cancelled';
  display_order: number;
}

export interface AnnouncementData {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'urgent' | 'incident';
  audience: 'all' | 'day1' | 'day2';
  starts_at: string;
  ends_at: string | null;
  updated_at: string;
}

export interface BootstrapData {
  generated_at: string;
  timezone: 'Asia/Kolkata';
  edition: EditionData | null;
  schedule: ScheduleItem[];
  announcements: AnnouncementData[];
}

export interface ScheduleFilters {
  day: string;
  kind: string;
  location: string;
  query: string;
  savedOnly?: boolean;
}
