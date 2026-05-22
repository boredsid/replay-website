// src/lib/types.ts
export type Day = 'day1' | 'day2';
export type PassType = 'oneshot' | 'campaign';
export type GuildTier = 'initiate' | 'adventurer' | 'guildmaster';
export type RegistrationStatus = 'upcoming' | 'open' | 'sold_out' | 'closed';
export type SponsorTier = 'title' | 'gold' | 'silver' | 'partner';
export type ScheduleKind = 'workshop' | 'tournament' | 'open-play' | 'meal' | 'talk';
export type StepReached = 'phone_entered' | 'name_entered' | 'details_entered';

export interface EditionRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  capacity_per_day: { day1: number; day2: number };
  pricing: {
    oneshot: { day1: number; day2: number };
    campaign: number;
    adventurer_cap?: number;
  };
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
  start_time: string;
  end_time: string;
  title: string;
  description: string | null;
  location: string | null;
  kind: ScheduleKind;
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

export interface ApiRegisterRequest {
  phone: string;
  name: string;
  email: string;
  edition_id: string;
  pass_type: PassType;
  days: Day[];
  source?: Record<string, string> | null;
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
