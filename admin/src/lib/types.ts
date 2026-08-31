export type PaymentStatus = 'confirmed' | 'pending' | 'cancelled';
export type PassType = 'oneshot' | 'campaign';
export type Day = 'day1' | 'day2';
export type PartnerKind = 'booth' | 'community_engagement' | 'sponsorship';
export type PartnerPackageKey = 'standard_booth' | 'community_booth' | 'standard_engagement' | 'patron_engagement';
export type PartnerSponsorKey =
  | 'title_sponsor'
  | 'association_sponsor'
  | 'zone_sponsor'
  | 'gaming_sponsor'
  | 'venue_sponsor';
/** Everything an admin can sell a partner: the four packages plus the sponsorship ladder. */
export type PartnerOfferKey = PartnerPackageKey | PartnerSponsorKey;
/** Where a partner is in the funnel. Generated in Postgres — never written directly. */
export type PartnerStage = 'lead' | 'prospective' | 'confirmed' | 'cancelled';

export interface RegistrationRow {
  id: string;
  user_phone: string;
  pass_type: PassType;
  days: Day[];
  seats: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  created_at: string;
  users?: { name: string | null } | null;
}

export interface LeadRow {
  id: string;
  edition_id: string | null;
  phone: string;
  name: string | null;
  step_reached: string;
  created_at: string;
  converted_at: string | null;
  editions?: { slug: string; name: string; start_date: string } | null;
}

export interface AuditEntry {
  id: string;
  actor_email: string;
  action: string;
  target_table: string;
  target_id: string | null;
  diff: unknown;
  created_at: string;
}

export interface DashboardData {
  edition: { id: string; slug: string; name: string; registration_status: string };
  spots_by_day: { day1: SpotCount; day2: SpotCount };
  totals: { confirmed: number; pending: number; cancelled: number; revenue: number };
  recent_registrations: RegistrationRow[];
  recent_leads: LeadRow[];
}
export interface SpotCount { capacity: number; reserved: number; remaining: number; }

export interface EditionPricing {
  oneshot: number;                 // shared price for any one-day pass
  campaign: number | null;         // null for single-day editions
  adventurer_cap: number;
}

export interface PartnerPricing {
  gst_rate: number;
  standard_booth: number;
  community_booth: number;
  standard_engagement: number;
  patron_engagement: number;
}

export function oneDayPrice(pricing: { oneshot: unknown }): number {
  if (typeof pricing.oneshot === 'number') return pricing.oneshot;
  if (!pricing.oneshot || typeof pricing.oneshot !== 'object' || Array.isArray(pricing.oneshot)) return Number.NaN;
  const legacy = pricing.oneshot as Record<string, unknown>;
  const values = Object.values(legacy);
  return typeof legacy.day1 === 'number' && values.every((value) => value === legacy.day1)
    ? legacy.day1
    : Number.NaN;
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
  accessibility_details?: string | null;
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
  capacity_per_day: Record<string, number>; // day1..dayN
  pricing: EditionPricing;
  partner_pricing?: PartnerPricing;
  registration_status: 'upcoming' | 'open' | 'sold_out' | 'closed';
  is_current: boolean;
  is_published: boolean;
}

export type ScheduleSection = 'always-on' | 'programme' | 'playtesting' | 'publisher-showcase' | 'event-floor';
export type ScheduleKind = 'workshop' | 'tournament' | 'open-play' | 'meal' | 'talk' | 'ttrpg' | 'story-game' | 'puzzle' | 'quiz' | 'social-game' | 'playtest' | 'publisher-showcase' | 'booth' | 'food' | 'merch' | 'amenity' | 'special';
export type ScheduleSignupMode = 'none' | 'walk-in' | 'advance' | 'on-site';
export type SchedulePublicStatus = 'draft' | 'published' | 'cancelled';

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
  created_at: string;
}

export type AnnouncementSeverity = 'info' | 'urgent' | 'incident';
export type AnnouncementAudience = 'all' | 'day1' | 'day2';

export interface AnnouncementRow {
  id: string;
  edition_id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  starts_at: string;
  ends_at: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export type SponsorTier = 'title' | 'association' | 'venue' | 'zone' | 'gaming' | 'community';

export interface SponsorRow {
  id: string;
  edition_id: string;
  name: string;
  tier: SponsorTier;
  /** Public address of the artwork; the site downloads it at build time. */
  logo_url: string;
  /** Object key in the `sponsor-logos` bucket, or null if hosted elsewhere. */
  logo_path: string | null;
  website_url: string | null;
  /** Join the site header lockup. Only the title and association tiers read it. */
  show_in_header: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  registration_count: number;
}

export interface UserDetail {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  registrations: Array<{
    id: string;
    pass_type: string;
    days: string[];
    amount_paid: number;
    payment_status: string;
    created_at: string;
    editions?: { slug: string; name: string } | null;
  }>;
  orders: Array<{ id: string; total: number; payment_status: string; created_at: string }>;
}

export interface PartnerRow {
  id: string;
  edition_id: string;
  organization_name: string;
  /** Null until the partner fills in their own link. */
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  gstin: string | null;
  kind: PartnerKind;
  package_key: PartnerOfferKey;
  days: Day[];
  details: string | null;
  internal_notes: string | null;
  base_amount: number;
  gst_amount: number;
  total_amount: number;
  payment_status: PaymentStatus;
  stage: PartnerStage;
  invite_token: string | null;
  /** Built by the Worker from the token — this is what gets sent to a partner. */
  invite_url: string | null;
  invite_created_by: string | null;
  invite_expires_at: string | null;
  submitted_at: string | null;
  payment_claimed_at: string | null;
  source: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type PromoDiscountType = 'percent' | 'flat';
export type PromoScope = 'booking' | 'first_ticket';

export interface PromoCodeRow {
  id: string;
  edition_id: string;
  /** Stored canonical uppercase; attendees may type it any way. */
  code: string;
  /** Shown to the attendee the moment the code is accepted. */
  applied_message: string;
  internal_note: string | null;
  discount_type: PromoDiscountType;
  discount_value: number;
  /** Ceiling for a percentage code. Null means uncapped; always null for flat. */
  max_discount: number | null;
  scope: PromoScope;
  /** Null when the code works on either pass. */
  pass_type: PassType | null;
  starts_at: string | null;
  ends_at: string | null;
  /** Null means unlimited. */
  max_redemptions: number | null;
  max_per_phone: number;
  is_active: boolean;
  /** Derived from uncancelled registrations, never a stored counter. */
  redemption_count: number;
  created_at: string;
  updated_at: string;
}
