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
import { getEditionById, getReservedSeatsByDay } from './editions';
import { sendRegistrationConfirmation } from './registration-email';
import { publicRequestAllowed } from './rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export async function handleRegister(req: Request, env: Env): Promise<Response> {
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
  const source = readSource(body.source);

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!name || name.length > 120) return jsonResponse({ error: 'invalid name' }, 400);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid email' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!passType) return jsonResponse({ error: 'invalid pass_type' }, 400);
  if (!days) return jsonResponse({ error: 'invalid days' }, 400);
  if (passType === 'campaign' && (days.length !== 2 || !days.includes('day1') || !days.includes('day2'))) {
    return jsonResponse({ error: 'campaign requires both days' }, 400);
  }
  if (passType === 'oneshot' && days.length !== 1) {
    return jsonResponse({ error: 'oneshot requires exactly one day' }, 400);
  }

  if (!(await publicRequestAllowed(env, req, 'register', phone))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const edition = await getEditionById(env, editionId);
  if (!edition) return jsonResponse({ error: 'edition not found' }, 404);
  if (edition.registration_status !== 'open') {
    return jsonResponse({ error: 'registration_closed' }, 409);
  }

  const pricing = readPricing(edition.pricing);
  const base = calculateBasePrice(pricing, passType, days);

  // Create a new user or fill only missing identity fields. A public
  // registration must never replace an existing name or email based solely on
  // possession of the phone number.
  const sb = serviceClient(env);
  const userLookup = await sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle();
  if (userLookup.error) return jsonResponse({ error: 'user_lookup_failed' }, 500);
  let registrationName = name;
  let registrationEmail = email;
  if (!userLookup.data) {
    const insertedUser = await sb.from('users').insert({ phone, name, email }).select().single();
    if (insertedUser.error || !insertedUser.data) return jsonResponse({ error: 'user_insert_failed' }, 500);
  } else {
    const patch: any = {};
    const storedName = userLookup.data.name?.trim() ?? '';
    const storedEmail = userLookup.data.email?.trim().toLowerCase() ?? '';
    if (!storedName) patch.name = name;
    if (!storedEmail) patch.email = email;
    if (Object.keys(patch).length > 0) {
      const updatedUser = await sb.from('users').update(patch).eq('phone', phone);
      if (updatedUser.error) return jsonResponse({ error: 'user_update_failed' }, 500);
    }
    registrationName = storedName || name;
    registrationEmail = storedEmail || email;
  }

  // Guild lookup + anti-split + discount
  const guild = await fetchGuildStatus(env, phone);
  const existingRegsRes = await sb
    .from('registrations')
    .select('payment_status')
    .eq('edition_id', editionId)
    .eq('user_phone', phone)
    .neq('payment_status', 'cancelled');
  if (existingRegsRes.error) return jsonResponse({ error: 'registration_lookup_failed' }, 500);
  const existingCount = (existingRegsRes.data ?? []).length;
  const discountBlocked = guild.active && existingCount > 0;

  let discount = 0;
  let tierStored: typeof guild.tier = null;
  if (!discountBlocked && guild.active) {
    discount = calculateDiscount({ base, tier: guild.tier, adventurer_cap: pricing.adventurer_cap });
    tierStored = guild.tier;
  }

  // Capacity gate
  const seatsByDay = await getReservedSeatsByDay(env, editionId);
  for (const d of days) {
    if (seatsByDay[d] + 1 > edition.capacity_per_day[d]) {
      return jsonResponse({ error: 'sold_out', day: d }, 409);
    }
  }

  const amountPaid = base - discount;
  const paymentStatus = amountPaid === 0 ? 'confirmed' : 'pending';

  const regInsert = await sb
    .from('registrations')
    .insert({
      edition_id: editionId,
      user_phone: phone,
      pass_type: passType,
      days,
      seats: 1,
      amount_paid: amountPaid,
      discount_applied: discount,
      guild_tier_at_purchase: tierStored,
      payment_status: paymentStatus,
      source,
    })
    .select()
    .single();
  if (regInsert.error || !regInsert.data) {
    const match = regInsert.error?.message?.match(/capacity_exceeded:(day1|day2)/);
    if (match) return jsonResponse({ error: 'sold_out', day: match[1] }, 409);
    return jsonResponse({ error: 'registration_insert_failed' }, 500);
  }
  const reg = regInsert.data as { id: string };

  // Convert any matching lead
  const leadConversion = await sb.from('leads').update({ converted_at: new Date().toISOString() }).eq('edition_id', editionId).eq('phone', phone);
  if (leadConversion.error) console.error('lead_conversion_failed', leadConversion.error.message);

  // Email if zero-payment
  if (amountPaid === 0) {
    try {
      await sendRegistrationConfirmation(env, edition, {
        name: registrationName,
        email: registrationEmail,
        passType,
        days,
        amountPaid,
        discount,
        tier: tierStored,
      });
    } catch (e) {
      // Email failure should not break registration; log and continue.
      console.error('email_failed', e);
    }
  }

  return jsonResponse({
    registration_id: reg.id,
    final_amount: amountPaid,
    discount_applied: discount,
    discount_blocked: discountBlocked,
    payment_required: amountPaid > 0,
  });
}
