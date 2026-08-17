export type PaymentStatus = 'confirmed' | 'pending' | 'cancelled';
export type PassType = 'oneshot' | 'campaign';
export type Day = 'day1' | 'day2';

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
  phone: string;
  name: string | null;
  step_reached: string;
  created_at: string;
  converted_at: string | null;
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
  oneshot: Record<string, number>; // per-day prices keyed day1..dayN
  campaign: number | null;         // null for single-day editions
  adventurer_cap: number;
}

export interface EditionRow {
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
  registration_status: 'upcoming' | 'open' | 'sold_out' | 'closed';
  is_current: boolean;
  is_published: boolean;
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
