// scripts/lib/mappers.ts
// Pure CSV-row -> DB-row mappers + helpers. No I/O, no env access.

export type PaymentStatus = 'confirmed' | 'cancelled' | 'pending';
export type PassType = 'oneshot' | 'campaign';
export type Day = 'day1' | 'day2';
export type GuildTier = 'initiate' | 'adventurer' | 'guildmaster';
export type Channel = 'website' | 'whatsaround' | 'swiggy';

export interface EditionPricing {
  oneshot: { day1?: number; day2?: number };
  campaign: number | null;
  adventurer_cap?: number;
}

export interface UserUpsert {
  phone: string;
  name: string | null;
  email: string | null;
}

export interface RegistrationInsert {
  user_phone: string;
  pass_type: PassType;
  days: Day[];
  seats: number;
  amount_paid: number;
  discount_applied: number;
  guild_tier_at_purchase: GuildTier | null;
  payment_status: PaymentStatus;
  source: { channel: Channel };
}

export interface OrderItem { name: string; qty: number; price: number; }

export interface OrderInsert {
  user_phone: string;
  items: OrderItem[];
  total: number;
  payment_status: PaymentStatus;
  source: { channel: Channel };
}

// Ported from worker/src/validation.ts — strip non-digits, require >=10, take last 10.
export function sanitizePhone(input: unknown): string {
  if (typeof input !== 'string') return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export function parsePaymentStatus(raw: string): PaymentStatus {
  const v = (raw ?? '').trim().toLowerCase();
  if (v.startsWith('cancel')) return 'cancelled';
  if (v === 'paid' || v === 'confirmed') return 'confirmed';
  if (v === 'pending') return 'pending';
  return 'pending'; // unknown/blank -> pending (excluded from confirmed counts)
}

export function parsePassAndDays(passTypeRaw: string, dayRaw: string): { pass_type: PassType; days: Day[] } {
  const pass = (passTypeRaw ?? '').toLowerCase();
  const day = (dayRaw ?? '').toLowerCase();
  const pass_type: PassType = pass.includes('campaign') ? 'campaign' : 'oneshot';
  let days: Day[];
  if (day.includes('both')) days = ['day1', 'day2'];
  else if (day.includes('apr 18') || day.includes('saturday')) days = ['day1'];
  else if (day.includes('apr 19') || day.includes('sunday')) days = ['day2'];
  else days = pass_type === 'campaign' ? ['day1', 'day2'] : ['day1'];
  return { pass_type, days };
}

export function parseGuildTier(discountText: string): GuildTier | null {
  const v = (discountText ?? '').toLowerCase();
  if (v.includes('guildmaster')) return 'guildmaster';
  if (v.includes('adventurer')) return 'adventurer';
  if (v.includes('initiate')) return 'initiate';
  return null;
}

export function parseOrderItems(raw: string): OrderItem[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('order items not an array');
  return parsed.map((it: any) => {
    if (typeof it?.name !== 'string' || typeof it?.qty !== 'number' || typeof it?.price !== 'number') {
      throw new Error('malformed order item');
    }
    return { name: it.name, qty: it.qty, price: it.price };
  });
}

export function normalizeChannel(source: string): Channel {
  const v = (source ?? '').toLowerCase();
  if (v.includes('swiggy')) return 'swiggy';
  if (v.includes('whataround') || v.includes('whatsaround')) return 'whatsaround';
  return 'website';
}

export function expectedBase(pricing: EditionPricing, pass_type: PassType, days: Day[], seats: number): number {
  let perPass: number;
  if (pass_type === 'campaign') {
    perPass = pricing.campaign ?? 0;
  } else {
    perPass = days.reduce((sum, d) => sum + (pricing.oneshot[d] ?? 0), 0);
  }
  return perPass * seats;
}

function toInt(raw: string, fallback: number): number {
  const n = parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toAmount(raw: string): number {
  const n = parseFloat((raw ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function mapReplay1Registration(row: Record<string, string>):
  { user: UserUpsert; registration: RegistrationInsert } | null {
  const phone = sanitizePhone(row['Phone Number']);
  if (!phone) return null;
  return {
    user: { phone, name: row['Name'] || null, email: null },
    registration: {
      user_phone: phone,
      pass_type: 'oneshot',
      days: ['day1'],
      seats: toInt(row['Seats'], 1),
      amount_paid: toAmount(row['Paid']),
      discount_applied: 0,
      guild_tier_at_purchase: null,
      payment_status: parsePaymentStatus(row['Status']),
      source: { channel: 'website' },
    },
  };
}

export function mapReplay2Registration(row: Record<string, string>, pricing: EditionPricing):
  { user: UserUpsert; registration: RegistrationInsert } | null {
  const phone = sanitizePhone(row['Phone']);
  if (!phone) return null;
  const { pass_type, days } = parsePassAndDays(row['Pass Type'], row['Day']);
  const seats = toInt(row['Quantity'], 1);
  const amount_paid = toAmount(row['Paid']);
  const base = expectedBase(pricing, pass_type, days, seats);
  return {
    user: { phone, name: row['Name'] || null, email: row['Email'] || null },
    registration: {
      user_phone: phone,
      pass_type,
      days,
      seats,
      amount_paid,
      discount_applied: Math.max(0, base - amount_paid),
      guild_tier_at_purchase: parseGuildTier(row['Discount']),
      payment_status: parsePaymentStatus(row['Payment Status']),
      source: { channel: normalizeChannel(row['Source']) },
    },
  };
}

export function mapReplay2Order(row: Record<string, string>):
  { user: UserUpsert; order: OrderInsert } | null {
  const phone = sanitizePhone(row['Phone']);
  if (!phone) return null;
  const items = parseOrderItems(row['Order Details']); // throws on malformed
  return {
    user: { phone, name: row['Name'] || null, email: row['Email'] || null },
    order: {
      user_phone: phone,
      items,
      total: toAmount(row['Amount paid']),
      payment_status: parsePaymentStatus(row['Payment Status']),
      source: { channel: 'website' },
    },
  };
}
