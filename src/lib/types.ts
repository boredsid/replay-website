// src/lib/types.ts
export type Day = 'day1' | 'day2';
export type PassType = 'oneshot' | 'campaign';
export type GuildTier = 'initiate' | 'adventurer' | 'guildmaster';
export type RegistrationStatus = 'upcoming' | 'open' | 'sold_out' | 'closed';
export type SponsorTier = 'title' | 'gold' | 'silver' | 'partner';
export type ScheduleSection = 'always-on' | 'programme' | 'playtesting' | 'publisher-showcase' | 'event-floor';
export type ScheduleKind =
  | 'workshop'
  | 'tournament'
  | 'open-play'
  | 'meal'
  | 'talk'
  | 'ttrpg'
  | 'puzzle'
  | 'quiz'
  | 'social-game'
  | 'playtest'
  | 'publisher-showcase'
  | 'booth'
  | 'food'
  | 'merch'
  | 'amenity'
  | 'special';
export type ScheduleSignupMode = 'none' | 'walk-in' | 'advance' | 'on-site';
export type SchedulePublicStatus = 'draft' | 'published' | 'cancelled';
export type StepReached = 'phone_entered' | 'name_entered' | 'details_entered';

export interface EditionPricing {
  oneshot: number;
  campaign: number;
  adventurer_cap?: number;
}

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
  game_library_process?: string | null;
  help_on_the_day?: string | null;
}

export interface EditionRow extends EditionVisitDetails {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  daily_start_time: string;
  daily_end_time: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: EditionPricing;
  registration_status: RegistrationStatus;
  is_current: boolean;
  is_published: boolean;
}

export interface SponsorRow {
  id: string;
  edition_id: string;
  name: string;
  tier: SponsorTier;
  logo_url: string;
  website_url: string | null;
  display_order: number;
}

export interface ScheduleItemRow {
  id: string;
  edition_id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  description: string | null;
  location: string | null;
  kind: ScheduleKind;
  section: ScheduleSection;
  is_all_day: boolean;
  host_name: string | null;
  signup_mode: ScheduleSignupMode;
  signup_url: string | null;
  public_status: SchedulePublicStatus;
  display_order: number;
}

// Worker response shapes
export interface ApiLookupPhoneResponse {
  user: { found: boolean; name: string | null; email: string | null };
  guild: { tier: GuildTier | null; active: boolean };
  existing_for_edition: { count: number; has_confirmed: boolean };
  discount_blocked: boolean;
}

export interface ApiEditionSpotsResponse {
  day1: { capacity: number; remaining: number; sold_out: boolean };
  day2: { capacity: number; remaining: number; sold_out: boolean };
  both_sold_out: boolean;
}

export interface ApiRegistrationDetails {
  phone: string;
  name: string;
  email: string;
  edition_id: string;
  pass_type: PassType;
  days: Day[];
  quantity: number;
  source?: Record<string, string> | null;
}

export interface ApiRegisterRequest extends ApiRegistrationDetails {
  registration_id?: string;
  expected_amount?: number;
}

export interface ApiRegisterPreviewResponse {
  payment_reference: string;
  final_amount: number;
  discount_applied: number;
  discount_blocked: boolean;
  payment_required: boolean;
}

export interface ApiRegisterResponse {
  registration_id: string;
  final_amount: number;
  discount_applied: number;
  discount_blocked: boolean;
  payment_required: boolean;
}

export interface ApiErrorResponse {
  error: string;
  field?: string;
  day?: Day;
}
