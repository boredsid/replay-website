import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { maskPhone } from './check-in';

/**
 * What a read-only viewer sees.
 *
 * Somebody on the door looking a booking up needs to find the right person and
 * know what they bought. They do not need what anyone paid, and they do not
 * need a full phone number — the last four are enough to check against what
 * the person in front of them says, which is the same bargain the door roster
 * already makes.
 *
 * Every money field goes, not only `amount_paid`: leaving the discount behind
 * would let the price be worked out from it, which makes the redaction
 * decorative.
 */
function redactRegistration<T extends Record<string, unknown>>(row: T): T {
  const { amount_paid: _a, discount_applied: _d, promo_discount: _p, ...rest } = row;
  return { ...rest, user_phone: maskPhone(String(row.user_phone ?? '')) } as unknown as T;
}
import { writeAudit, diffRows } from './audit';
import { sanitizePhone, parseDays, parsePassType } from '../validation';
import { getEditionBySlug, getCurrentEdition, getReservedSeatsByDay, type EditionRow } from '../editions';
import { sendRegistrationConfirmation } from '../registration-email';
import { normalizePromoCode, evaluatePromo } from '../promo';
import { loadPromoContext } from '../promo-lookup';
import { readPricing, calculateBasePrice } from '../pricing';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ceiling on an admin seat correction. Deliberately above the public form's 10,
// because the desk merges walk-ups into one row; beyond this it is a typo.
const MAX_SEATS = 20;

function daysMatchPass(passType: 'oneshot' | 'campaign', days: Array<'day1' | 'day2'>): boolean {
  if (passType === 'oneshot') return days.length === 1;
  return days.length === 2 && days.includes('day1') && days.includes('day2');
}

export async function handleRegList(req: Request, env: Env, sb: SupabaseClient, origin: string, redact = false): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const slug = params.get('edition');
  const status = params.get('status');
  const q = (params.get('q') || '').trim();

  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  let query = sb
    .from('registrations')
    // The discount columns ride along so the list can mark why a row costs
    // what it does — a ₹0 guild pass and a ₹0 comp are otherwise identical.
    .select('id, user_phone, pass_type, days, seats, amount_paid, discount_applied, guild_tier_at_purchase, promo_code, promo_discount, source, payment_status, created_at, users(name)')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('payment_status', status);
  const { data, error } = await query;
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);

  let rows = (data ?? []) as any[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) => r.user_phone.includes(q) || (r.users?.name || '').toLowerCase().includes(needle),
    );
  }
  return adminJson({
    edition: { id: edition.id, slug: edition.slug },
    registrations: redact ? rows.map(redactRegistration) : rows,
    redacted: redact,
  }, 200, origin);
}

export async function handleRegGet(env: Env, sb: SupabaseClient, id: string, origin: string, redact = false): Promise<Response> {
  const { data, error } = await sb
    .from('registrations')
    .select('*, users(name, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({
    registration: redact ? redactRegistration(data as Record<string, unknown>) : data,
    redacted: redact,
  }, 200, origin);
}

export async function handleRegCreate(req: Request, env: Env, sb: SupabaseClient, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const phone = sanitizePhone(body.phone);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const userEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  const amountPaid = Number(body.amount_paid);
  const paymentStatus = body.payment_status === 'pending' ? 'pending' : 'confirmed';
  const sendMail = body.send_email === true;
  const slug = typeof body.edition === 'string' ? body.edition : null;

  if (!phone) return adminJson({ error: 'invalid phone' }, 400, origin);
  if (!passType) return adminJson({ error: 'invalid pass_type' }, 400, origin);
  if (!days) return adminJson({ error: 'invalid days' }, 400, origin);
  if (!daysMatchPass(passType, days)) return adminJson({ error: 'pass_days_mismatch' }, 400, origin);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return adminJson({ error: 'invalid_amount' }, 400, origin);
  if (userEmail && (userEmail.length > 254 || !EMAIL_RE.test(userEmail))) return adminJson({ error: 'invalid_email' }, 400, origin);
  if (name.length > 120) return adminJson({ error: 'invalid_name' }, 400, origin);

  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  // A code redeemed at the door is a real redemption: it is recorded against
  // the same limits the public form checks. The admin's typed `amount_paid`
  // still stands, because a manual entry may settle a different way (part
  // cash, a comp, a correction) than the code's face value.
  let promoId: string | null = null;
  let promoCode: string | null = null;
  let promoDiscount = 0;
  const promoInput = normalizePromoCode(body.promo_code);
  if (typeof body.promo_code === 'string' && body.promo_code.trim() !== '') {
    if (!promoInput) return adminJson({ error: 'promo_not_found' }, 404, origin);
    const context = await loadPromoContext(sb, edition.id, promoInput, phone);
    if (!context) return adminJson({ error: 'promo_lookup_failed' }, 500, origin);
    const ticketPrice = calculateBasePrice(readPricing(edition.pricing), passType, days);
    const result = evaluatePromo({
      promo: context.promo,
      ticketPrice,
      quantity: 1,
      passType,
      redemptions: context.redemptions,
    });
    if (!result.ok) return adminJson({ error: result.reason }, 409, origin);
    promoId = result.id;
    promoCode = result.code;
    promoDiscount = result.discount;
  }

  const reserved = await getReservedSeatsByDay(env, edition.id);
  for (const day of days) {
    if (reserved[day] + 1 > edition.capacity_per_day[day]) {
      return adminJson({ error: 'sold_out', day }, 409, origin);
    }
  }

  // User upsert: create if new; only fill empty name/email (never clobber).
  const existing = await sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle();
  if (existing.error) return adminJson({ error: 'user_lookup_failed' }, 500, origin);
  if (!existing.data) {
    const inserted = await sb.from('users').insert({ phone, name: name || null, email: userEmail || null }).select().single();
    if (inserted.error || !inserted.data) return adminJson({ error: 'user_insert_failed' }, 500, origin);
  } else {
    const patch: any = {};
    if (name && !(existing.data as any).name) patch.name = name;
    if (userEmail && !(existing.data as any).email) patch.email = userEmail;
    if (Object.keys(patch).length) {
      const updated = await sb.from('users').update(patch).eq('phone', phone);
      if (updated.error) return adminJson({ error: 'user_update_failed' }, 500, origin);
    }
  }

  const regRes = await sb
    .from('registrations')
    .insert({
      edition_id: edition.id,
      user_phone: phone,
      pass_type: passType,
      days,
      seats: 1,
      amount_paid: amountPaid,
      discount_applied: promoDiscount,
      guild_tier_at_purchase: null,
      promo_code_id: promoId,
      promo_code: promoCode,
      promo_discount: promoDiscount,
      payment_status: paymentStatus,
      source: { manual: true, by: email },
    })
    .select()
    .single();
  if (regRes.error || !regRes.data) {
    const match = regRes.error?.message?.match(/capacity_exceeded:(day1|day2)/);
    if (match) return adminJson({ error: 'sold_out', day: match[1] }, 409, origin);
    return adminJson({ error: 'insert_failed' }, 500, origin);
  }
  const reg = regRes.data as { id: string };

  await writeAudit(sb, { actor_email: email, action: 'registration.create', target_table: 'registrations', target_id: reg.id, diff: regRes.data });

  if (sendMail && userEmail) {
    try {
      await sendRegistrationConfirmation(env, edition, { name, email: userEmail, passType, days, seats: 1, amountPaid, discount: promoDiscount, tier: null, promoCode });
    } catch (e) { console.error('email_failed', e); }
  }

  return adminJson({ ok: true, registration_id: reg.id }, 200, origin);
}

/**
 * Editing a registration after the fact.
 *
 * Details (pass, days, seats, amount) are corrections: an organiser fixing what
 * was sold. Status is a transition, and confirming one still sends the mail the
 * attendee never got. Both arrive here so a single audit entry records the whole
 * change.
 *
 * Two rules are enforced above the database because the database can only see
 * one row at a time:
 *  - pass type and days must agree AFTER the merge, so changing one of the pair
 *    cannot leave a 2-day pass covering a single day;
 *  - a day already checked in cannot be dropped, which would strand check-in
 *    events on a day nobody bought. Capacity and seat reduction are guarded by
 *    triggers, and their errors are translated below.
 */
export async function handleRegPatch(req: Request, env: Env, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb
    .from('registrations')
    .select('id, edition_id, user_phone, pass_type, days, seats, payment_status, amount_paid, discount_applied, guild_tier_at_purchase, promo_code, users(name, email), editions(*)')
    .eq('id', id)
    .maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);
  const current = before.data as any;

  const patch: any = {};
  if (body.payment_status === 'confirmed' || body.payment_status === 'pending' || body.payment_status === 'cancelled') {
    patch.payment_status = body.payment_status;
  }
  if (body.amount_paid !== undefined) {
    const amount = Number(body.amount_paid);
    if (!Number.isFinite(amount) || amount < 0) return adminJson({ error: 'invalid_amount' }, 400, origin);
    patch.amount_paid = amount;
  }
  if (body.pass_type !== undefined) {
    const passType = parsePassType(body.pass_type);
    if (!passType) return adminJson({ error: 'invalid pass_type' }, 400, origin);
    patch.pass_type = passType;
  }
  if (body.days !== undefined) {
    const days = parseDays(body.days);
    if (!days) return adminJson({ error: 'invalid days' }, 400, origin);
    patch.days = days;
  }
  if (body.seats !== undefined) {
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) return adminJson({ error: 'invalid_seats' }, 400, origin);
    patch.seats = seats;
  }
  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  // Only when the request touches the pair: a status-only change must not be
  // refused because of how the row was already stored.
  if (patch.pass_type || patch.days) {
    const nextPassType = (patch.pass_type ?? current.pass_type) as 'oneshot' | 'campaign';
    const nextDays = (patch.days ?? current.days) as Array<'day1' | 'day2'>;
    if (!daysMatchPass(nextPassType, nextDays)) return adminJson({ error: 'pass_days_mismatch' }, 400, origin);
  }

  if (patch.days) {
    const nextDays = patch.days as Array<'day1' | 'day2'>;
    const dropped = (current.days as Array<'day1' | 'day2'>).filter((day) => !nextDays.includes(day));
    if (dropped.length) {
      const checked = await checkedInDays(sb, id, dropped);
      if (checked === null) return adminJson({ error: 'query_failed' }, 500, origin);
      if (checked.length) return adminJson({ error: 'day_checked_in', day: checked[0] }, 409, origin);
    }
  }

  const upd = await sb.from('registrations').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) {
    const message = upd.error?.message ?? '';
    const match = message.match(/capacity_exceeded:(day1|day2)/);
    if (match) return adminJson({ error: 'sold_out', day: match[1] }, 409, origin);
    if (message.includes('seat_reduction_blocked')) return adminJson({ error: 'seats_in_use' }, 409, origin);
    return adminJson({ error: 'update_failed' }, 500, origin);
  }
  const after = upd.data as any;

  const diff = diffRows(current, { ...current, ...patch });
  await writeAudit(sb, { actor_email: email, action: 'registration.update', target_table: 'registrations', target_id: id, diff });

  let emailSent = false;
  let emailSkipped: 'missing_email' | 'failed' | null = null;
  const wasConfirmed = current.payment_status === 'confirmed';
  const isNowConfirmed = after.payment_status === 'confirmed';
  if (!wasConfirmed && isNowConfirmed) {
    const user = current.users as { name: string | null; email: string | null } | null;
    const edition = current.editions as EditionRow | null;
    if (!user?.email || !edition) {
      emailSkipped = 'missing_email';
    } else {
      try {
        // The mail describes the pass as it now stands, not as it arrived: a
        // correction and a confirmation can land in the same request.
        await sendRegistrationConfirmation(env, edition, {
          name: user.name || 'Guest',
          email: user.email,
          passType: after.pass_type,
          days: after.days,
          seats: Number(after.seats),
          amountPaid: Number(after.amount_paid),
          discount: Number(current.discount_applied || 0),
          tier: current.guild_tier_at_purchase,
          promoCode: current.promo_code ?? null,
        });
        emailSent = true;
      } catch (error) {
        console.error('confirmation_email_failed', error);
        emailSkipped = 'failed';
      }
    }
  }

  return adminJson({ ok: true, registration: after, email_sent: emailSent, email_skipped: emailSkipped }, 200, origin);
}

/**
 * Which of `days` already carry a check-in on this registration's seats.
 *
 * Voided events count: an undone check-in still names a day someone was at the
 * door for, and the row survives the day being removed either way.
 */
async function checkedInDays(
  sb: SupabaseClient,
  registrationId: string,
  days: Array<'day1' | 'day2'>,
): Promise<Array<'day1' | 'day2'> | null> {
  const seats = await sb.from('attendees').select('id').eq('registration_id', registrationId);
  if (seats.error) return null;
  const ids = (seats.data ?? []).map((row: any) => row.id);
  if (!ids.length) return [];

  const events = await sb.from('check_in_events').select('day').in('attendee_id', ids).in('day', days);
  if (events.error) return null;
  return [...new Set((events.data ?? []).map((row: any) => row.day as 'day1' | 'day2'))];
}
