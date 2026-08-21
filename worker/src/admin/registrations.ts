import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { sanitizePhone, parseDays, parsePassType } from '../validation';
import { getEditionBySlug, getCurrentEdition, getReservedSeatsByDay, type EditionRow } from '../editions';
import { sendRegistrationConfirmation } from '../registration-email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function daysMatchPass(passType: 'oneshot' | 'campaign', days: Array<'day1' | 'day2'>): boolean {
  if (passType === 'oneshot') return days.length === 1;
  return days.length === 2 && days.includes('day1') && days.includes('day2');
}

export async function handleRegList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const slug = params.get('edition');
  const status = params.get('status');
  const q = (params.get('q') || '').trim();

  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  let query = sb
    .from('registrations')
    .select('id, user_phone, pass_type, days, seats, amount_paid, payment_status, created_at, users(name)')
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
  return adminJson({ edition: { id: edition.id, slug: edition.slug }, registrations: rows }, 200, origin);
}

export async function handleRegGet(env: Env, sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const { data, error } = await sb
    .from('registrations')
    .select('*, users(name, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ registration: data }, 200, origin);
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
      discount_applied: 0,
      guild_tier_at_purchase: null,
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
      await sendRegistrationConfirmation(env, edition, { name, email: userEmail, passType, days, seats: 1, amountPaid, discount: 0, tier: null });
    } catch (e) { console.error('email_failed', e); }
  }

  return adminJson({ ok: true, registration_id: reg.id }, 200, origin);
}

export async function handleRegPatch(req: Request, env: Env, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb
    .from('registrations')
    .select('id, edition_id, user_phone, pass_type, days, seats, payment_status, amount_paid, discount_applied, guild_tier_at_purchase, users(name, email), editions(*)')
    .eq('id', id)
    .maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const patch: any = {};
  if (body.payment_status === 'confirmed' || body.payment_status === 'pending' || body.payment_status === 'cancelled') {
    patch.payment_status = body.payment_status;
  }
  if (body.amount_paid !== undefined) {
    const amount = Number(body.amount_paid);
    if (!Number.isFinite(amount) || amount < 0) return adminJson({ error: 'invalid_amount' }, 400, origin);
    patch.amount_paid = amount;
  }
  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('registrations').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) {
    const match = upd.error?.message?.match(/capacity_exceeded:(day1|day2)/);
    if (match) return adminJson({ error: 'sold_out', day: match[1] }, 409, origin);
    return adminJson({ error: 'update_failed' }, 500, origin);
  }

  const diff = diffRows(before.data as any, { ...(before.data as any), ...patch });
  await writeAudit(sb, { actor_email: email, action: 'registration.update', target_table: 'registrations', target_id: id, diff });

  let emailSent = false;
  let emailSkipped: 'missing_email' | 'failed' | null = null;
  const wasConfirmed = (before.data as any).payment_status === 'confirmed';
  const isNowConfirmed = (upd.data as any).payment_status === 'confirmed';
  if (!wasConfirmed && isNowConfirmed) {
    const detail = before.data as any;
    const user = detail.users as { name: string | null; email: string | null } | null;
    const edition = detail.editions as EditionRow | null;
    if (!user?.email || !edition) {
      emailSkipped = 'missing_email';
    } else {
      try {
        await sendRegistrationConfirmation(env, edition, {
          name: user.name || 'Guest',
          email: user.email,
          passType: detail.pass_type,
          days: detail.days,
          seats: Number(detail.seats),
          amountPaid: Number((upd.data as any).amount_paid),
          discount: Number(detail.discount_applied || 0),
          tier: detail.guild_tier_at_purchase,
        });
        emailSent = true;
      } catch (error) {
        console.error('confirmation_email_failed', error);
        emailSkipped = 'failed';
      }
    }
  }

  return adminJson({ ok: true, registration: upd.data, email_sent: emailSent, email_skipped: emailSkipped }, 200, origin);
}
