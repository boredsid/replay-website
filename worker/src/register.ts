// worker/src/register.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import {
  sanitizePhone,
  parseDays,
  parsePassType,
  jsonResponse,
} from './validation';
import { readPricing, calculateBasePrice, calculateDiscount } from './pricing';
import { normalizePromoCode, evaluatePromo, resolveDiscount, type PromoResult, type DiscountSource } from './promo';
import { loadPromoContext } from './promo-lookup';
import { getEditionById, getReservedSeatsByDay, type EditionRow } from './editions';
import { sendRegistrationConfirmation } from './registration-email';
import { publicRequestAllowed } from './rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TICKET_QUANTITY = 10;

type ServiceClient = ReturnType<typeof serviceClient>;
type GuildStatus = Awaited<ReturnType<typeof fetchGuildStatus>>;

interface RegistrationInput {
  phone: string;
  name: string;
  email: string;
  editionId: string;
  passType: 'oneshot' | 'campaign';
  days: Array<'day1' | 'day2'>;
  quantity: number;
  /** Canonical uppercase code, or '' when the attendee typed nothing usable. */
  promoCode: string;
  /** Whether a code was typed at all, so garbage is refused rather than ignored. */
  promoSupplied: boolean;
  source: Record<string, string> | null;
}

interface RegistrationEvaluation {
  edition: EditionRow;
  discount: number;
  amountPaid: number;
  discountBlocked: boolean;
  tierStored: GuildStatus['tier'];
  promo: PromoResult | null;
  promoDiscount: number;
  discountSource: DiscountSource;
}

interface ExistingRegistration {
  id: string;
  edition_id: string;
  user_phone: string;
  pass_type: 'oneshot' | 'campaign';
  days: Array<'day1' | 'day2'>;
  seats: number;
  amount_paid: number;
  discount_applied: number;
  promo_code: string | null;
  promo_discount: number;
  payment_status: 'confirmed' | 'pending' | 'cancelled';
}
function readSource(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer'];
  const source: Record<string, string> = {};
  for (const key of allowed) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) source[key] = value.trim().slice(0, 200);
  }
  return Object.keys(source).length > 0 ? source : null;
}

async function parseRegistrationRequest(req: Request): Promise<{ body: any; input: RegistrationInput } | Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  const phone = sanitizePhone(body.phone);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  // Default to one during the rolling deploy so the previous public client
  // remains compatible while the new quantity field reaches production.
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  const promoSupplied = typeof body.promo_code === 'string' && body.promo_code.trim() !== '';
  const promoCode = promoSupplied ? normalizePromoCode(body.promo_code) : '';

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!name || name.length > 120) return jsonResponse({ error: 'invalid name' }, 400);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid email' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!passType) return jsonResponse({ error: 'invalid pass_type' }, 400);
  if (!days) return jsonResponse({ error: 'invalid days' }, 400);
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKET_QUANTITY) {
    return jsonResponse({ error: 'invalid quantity' }, 400);
  }
  if (passType === 'campaign' && (days.length !== 2 || !days.includes('day1') || !days.includes('day2'))) {
    return jsonResponse({ error: 'campaign requires both days' }, 400);
  }
  if (passType === 'oneshot' && days.length !== 1) {
    return jsonResponse({ error: 'oneshot requires exactly one day' }, 400);
  }

  return {
    body,
    input: {
      phone,
      name,
      email,
      editionId,
      passType,
      days,
      quantity,
      promoCode,
      promoSupplied,
      source: readSource(body.source),
    },
  };
}

async function evaluateRegistration(
  env: Env,
  sb: ServiceClient,
  input: RegistrationInput,
): Promise<RegistrationEvaluation | Response> {
  const edition = await getEditionById(env, input.editionId);
  if (!edition) return jsonResponse({ error: 'edition not found' }, 404);
  if (edition.registration_status !== 'open') {
    return jsonResponse({ error: 'registration_closed' }, 409);
  }

  const pricing = readPricing(edition.pricing);
  const ticketPrice = calculateBasePrice(pricing, input.passType, input.days);
  const base = ticketPrice * input.quantity;

  const guild = await fetchGuildStatus(env, input.phone);
  const existingRegsRes = await sb
    .from('registrations')
    .select('payment_status')
    .eq('edition_id', input.editionId)
    .eq('user_phone', input.phone)
    .neq('payment_status', 'cancelled');
  if (existingRegsRes.error) return jsonResponse({ error: 'registration_lookup_failed' }, 500);
  const existingCount = (existingRegsRes.data ?? []).length;
  const discountBlocked = guild.active && existingCount > 0;

  let guildDiscount = 0;
  if (!discountBlocked && guild.active) {
    // A Guild Path membership belongs to the buyer, so its benefit applies to
    // the first ticket rather than every guest ticket in the same booking.
    guildDiscount = calculateDiscount({ base: ticketPrice, tier: guild.tier, adventurer_cap: pricing.adventurer_cap });
  }

  // A refused code is reported back rather than failing the whole request: the
  // booking still goes through at full price, and the caller's expected_amount
  // check is what stops anyone being charged more than they agreed to.
  let promo: PromoResult | null = null;
  if (input.promoSupplied) {
    if (!input.promoCode) {
      promo = { ok: false, reason: 'promo_not_found' };
    } else {
      const context = await loadPromoContext(sb, input.editionId, input.promoCode, input.phone);
      if (!context) return jsonResponse({ error: 'promo_lookup_failed' }, 500);
      promo = evaluatePromo({
        promo: context.promo,
        ticketPrice,
        quantity: input.quantity,
        passType: input.passType,
        redemptions: context.redemptions,
      });
    }
  }

  const resolved = resolveDiscount({
    guildDiscount,
    promoDiscount: promo?.ok ? promo.discount : 0,
  });

  const seatsByDay = await getReservedSeatsByDay(env, input.editionId);
  for (const day of input.days) {
    if (seatsByDay[day] + input.quantity > edition.capacity_per_day[day]) {
      return jsonResponse({ error: 'sold_out', day }, 409);
    }
  }

  return {
    edition,
    discount: resolved.amount,
    amountPaid: base - resolved.amount,
    discountBlocked,
    // Only the discount that actually applied is attributed, so exactly one of
    // `guild_tier_at_purchase` and `promo_discount` is ever set on a row. A
    // member whose promo beat their tier records the promo, not the tier.
    tierStored: resolved.guildApplied ? guild.tier : null,
    promo,
    promoDiscount: resolved.promoDiscount,
    discountSource: resolved.source,
  };
}

/**
 * The promo block the browser renders: the accepted code with its admin-authored
 * message, or the reason it was refused. `applied` is false when a valid code
 * simply lost to a larger Guild Path benefit.
 */
function promoResponse(evaluation: RegistrationEvaluation): {
  code: string;
  applied: boolean;
  message: string;
  discount: number;
} | { error: string } | null {
  const { promo } = evaluation;
  if (!promo) return null;
  if (!promo.ok) return { error: promo.reason };
  return {
    code: promo.code,
    applied: evaluation.discountSource === 'promo',
    message: promo.message,
    discount: promo.discount,
  };
}

async function findExistingRegistration(sb: ServiceClient, registrationId: string): Promise<ExistingRegistration | null | Response> {
  const result = await sb
    .from('registrations')
    .select('id, edition_id, user_phone, pass_type, days, seats, amount_paid, discount_applied, promo_code, promo_discount, payment_status')
    .eq('id', registrationId)
    .maybeSingle();
  if (result.error) return jsonResponse({ error: 'registration_lookup_failed' }, 500);
  return (result.data as ExistingRegistration | null) ?? null;
}

function sameRegistration(existing: ExistingRegistration, input: RegistrationInput): boolean {
  return existing.edition_id === input.editionId
    && existing.user_phone === input.phone
    && existing.pass_type === input.passType
    && existing.seats === input.quantity
    && existing.days.length === input.days.length
    && input.days.every((day) => existing.days.includes(day));
}

function existingRegistrationResponse(existing: ExistingRegistration, input: RegistrationInput): Response {
  if (!sameRegistration(existing, input) || existing.payment_status === 'cancelled') {
    return jsonResponse({ error: 'registration_reference_conflict' }, 409);
  }
  return jsonResponse({
    registration_id: existing.id,
    final_amount: Number(existing.amount_paid),
    discount_applied: Number(existing.discount_applied),
    discount_blocked: false,
    promo_code: existing.promo_code,
    promo_discount: Number(existing.promo_discount ?? 0),
    payment_required: Number(existing.amount_paid) > 0,
  });
}

/**
 * Read-only pricing and capacity check. The returned payment reference is not
 * persisted until the attendee clicks "I've paid" and the client calls
 * handleRegister with that reference.
 */
export async function handleRegisterPreview(req: Request, env: Env): Promise<Response> {
  const parsed = await parseRegistrationRequest(req);
  if (parsed instanceof Response) return parsed;
  const { input } = parsed;

  if (!(await publicRequestAllowed(env, req, 'register-preview', input.phone))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const evaluation = await evaluateRegistration(env, serviceClient(env), input);
  if (evaluation instanceof Response) return evaluation;

  return jsonResponse({
    payment_reference: crypto.randomUUID(),
    final_amount: evaluation.amountPaid,
    discount_applied: evaluation.discount,
    discount_blocked: evaluation.discountBlocked,
    discount_source: evaluation.discountSource,
    promo: promoResponse(evaluation),
    payment_required: evaluation.amountPaid > 0,
  });
}

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  const parsed = await parseRegistrationRequest(req);
  if (parsed instanceof Response) return parsed;
  const { body, input } = parsed;
  const registrationId = typeof body.registration_id === 'string' ? body.registration_id : '';
  const expectedAmount = body.expected_amount;

  if (registrationId && !UUID_RE.test(registrationId)) {
    return jsonResponse({ error: 'invalid registration_id' }, 400);
  }
  if (expectedAmount !== undefined && (!Number.isFinite(expectedAmount) || expectedAmount < 0)) {
    return jsonResponse({ error: 'invalid expected_amount' }, 400);
  }
  if (!(await publicRequestAllowed(env, req, 'register', input.phone))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const sb = serviceClient(env);
  if (registrationId) {
    const existing = await findExistingRegistration(sb, registrationId);
    if (existing instanceof Response) return existing;
    if (existing) return existingRegistrationResponse(existing, input);
  }

  const evaluation = await evaluateRegistration(env, sb, input);
  if (evaluation instanceof Response) return evaluation;
  const { edition, discount, amountPaid, discountBlocked, tierStored, promo, promoDiscount } = evaluation;

  if (expectedAmount !== undefined && Number(expectedAmount) !== amountPaid) {
    return jsonResponse({ error: 'amount_changed', final_amount: amountPaid }, 409);
  }

  // Create a new user or fill only missing identity fields. A public
  // registration must never replace an existing name or email based solely on
  // possession of the phone number.
  const userLookup = await sb.from('users').select('phone, name, email').eq('phone', input.phone).maybeSingle();
  if (userLookup.error) return jsonResponse({ error: 'user_lookup_failed' }, 500);
  let registrationName = input.name;
  let registrationEmail = input.email;
  if (!userLookup.data) {
    const insertedUser = await sb.from('users').insert({ phone: input.phone, name: input.name, email: input.email }).select().single();
    if (insertedUser.error || !insertedUser.data) return jsonResponse({ error: 'user_insert_failed' }, 500);
  } else {
    const patch: Record<string, string> = {};
    const storedName = userLookup.data.name?.trim() ?? '';
    const storedEmail = userLookup.data.email?.trim().toLowerCase() ?? '';
    if (!storedName) patch.name = input.name;
    if (!storedEmail) patch.email = input.email;
    if (Object.keys(patch).length > 0) {
      const updatedUser = await sb.from('users').update(patch).eq('phone', input.phone);
      if (updatedUser.error) return jsonResponse({ error: 'user_update_failed' }, 500);
    }
    registrationName = storedName || input.name;
    registrationEmail = storedEmail || input.email;
  }

  const paymentStatus = amountPaid === 0 ? 'confirmed' : 'pending';
  const registration: Record<string, unknown> = {
    edition_id: input.editionId,
    user_phone: input.phone,
    pass_type: input.passType,
    days: input.days,
    seats: input.quantity,
    amount_paid: amountPaid,
    discount_applied: discount,
    guild_tier_at_purchase: tierStored,
    // Only a code that actually won the discount is recorded as redeemed, so a
    // code beaten by a Guild Path benefit does not burn a redemption.
    promo_code_id: promoDiscount > 0 && promo?.ok ? promo.id : null,
    promo_code: promoDiscount > 0 && promo?.ok ? promo.code : null,
    promo_discount: promoDiscount,
    payment_status: paymentStatus,
    source: input.source,
  };
  if (registrationId) registration.id = registrationId;

  const regInsert = await sb.from('registrations').insert(registration).select().single();
  if (regInsert.error || !regInsert.data) {
    const capacityMatch = regInsert.error?.message?.match(/capacity_exceeded:(day1|day2)/);
    if (capacityMatch) return jsonResponse({ error: 'sold_out', day: capacityMatch[1] }, 409);
    if (registrationId && regInsert.error?.code === '23505') {
      const existing = await findExistingRegistration(sb, registrationId);
      if (existing instanceof Response) return existing;
      if (existing) return existingRegistrationResponse(existing, input);
    }
    return jsonResponse({ error: 'registration_insert_failed' }, 500);
  }
  const reg = regInsert.data as { id: string };

  const leadConversion = await sb.from('leads').update({ converted_at: new Date().toISOString() }).eq('edition_id', input.editionId).eq('phone', input.phone);
  if (leadConversion.error) console.error('lead_conversion_failed', leadConversion.error.message);

  if (amountPaid === 0) {
    try {
      await sendRegistrationConfirmation(env, edition, {
        name: registrationName,
        email: registrationEmail,
        passType: input.passType,
        days: input.days,
        seats: input.quantity,
        amountPaid,
        discount,
        tier: tierStored,
        promoCode: promoDiscount > 0 && promo?.ok ? promo.code : null,
      });
    } catch (error) {
      console.error('email_failed', error);
    }
  }

  return jsonResponse({
    registration_id: reg.id,
    final_amount: amountPaid,
    discount_applied: discount,
    discount_blocked: discountBlocked,
    discount_source: evaluation.discountSource,
    promo: promoResponse(evaluation),
    payment_required: amountPaid > 0,
  });
}
