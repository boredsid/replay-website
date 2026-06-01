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
import { getEditionById, getConfirmedSeatsByDay } from './editions';
import { sendRegistrationConfirmation } from './registration-email';

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  const phone = sanitizePhone(body.phone);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  const source = body.source ?? null;

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!name) return jsonResponse({ error: 'invalid name' }, 400);
  if (!email) return jsonResponse({ error: 'invalid email' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!passType) return jsonResponse({ error: 'invalid pass_type' }, 400);
  if (!days) return jsonResponse({ error: 'invalid days' }, 400);
  if (passType === 'campaign' && (days.length !== 2 || !days.includes('day1') || !days.includes('day2'))) {
    return jsonResponse({ error: 'campaign requires both days' }, 400);
  }
  if (passType === 'oneshot' && days.length !== 1) {
    return jsonResponse({ error: 'oneshot requires exactly one day' }, 400);
  }

  const edition = await getEditionById(env, editionId);
  if (!edition) return jsonResponse({ error: 'edition not found' }, 404);
  if (edition.registration_status !== 'open') {
    return jsonResponse({ error: 'registration_closed' }, 409);
  }

  const pricing = readPricing(edition.pricing);
  const base = calculateBasePrice(pricing, passType, days);

  // Upsert user
  const sb = serviceClient(env);
  const userLookup = await sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle();
  if (!userLookup.data) {
    await sb.from('users').insert({ phone, name, email: email || null }).select().single();
  } else {
    const patch: any = {};
    if (name) patch.name = name;
    if (email) patch.email = email;
    if (Object.keys(patch).length > 0) {
      await sb.from('users').update(patch).eq('phone', phone);
    }
  }

  // Guild lookup + anti-split + discount
  const guild = await fetchGuildStatus(env, phone);
  const existingRegsRes = await sb
    .from('registrations')
    .select('payment_status')
    .eq('edition_id', editionId)
    .eq('user_phone', phone)
    .neq('payment_status', 'cancelled');
  const existingCount = (existingRegsRes.data ?? []).length;
  const discountBlocked = guild.active && existingCount > 0;

  let discount = 0;
  let tierStored: typeof guild.tier = null;
  if (!discountBlocked && guild.active) {
    discount = calculateDiscount({ base, tier: guild.tier, adventurer_cap: pricing.adventurer_cap });
    tierStored = guild.tier;
  }

  // Capacity gate
  const seatsByDay = await getConfirmedSeatsByDay(env, editionId);
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
    return jsonResponse({ error: 'registration_insert_failed' }, 500);
  }
  const reg = regInsert.data as { id: string };

  // Convert any matching lead
  await sb.from('leads').update({ converted_at: new Date().toISOString() }).eq('edition_id', editionId).eq('phone', phone);

  // Email if zero-payment
  if (amountPaid === 0) {
    try {
      await sendRegistrationConfirmation(env, edition, {
        name, email, passType, days, amountPaid, discount, tier: tierStored,
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
