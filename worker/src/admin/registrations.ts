import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit, diffRows } from './audit';
import { sanitizePhone, parseDays, parsePassType } from '../validation';
import { getEditionBySlug, getCurrentEdition } from '../editions';
import { sendRegistrationConfirmation } from '../registration-email';

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
  const userEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  const amountPaid = Number.isFinite(Number(body.amount_paid)) ? Number(body.amount_paid) : 0;
  const paymentStatus = body.payment_status === 'pending' ? 'pending' : 'confirmed';
  const sendMail = body.send_email === true;
  const slug = typeof body.edition === 'string' ? body.edition : null;

  if (!phone) return adminJson({ error: 'invalid phone' }, 400, origin);
  if (!passType) return adminJson({ error: 'invalid pass_type' }, 400, origin);
  if (!days) return adminJson({ error: 'invalid days' }, 400, origin);

  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  // User upsert: create if new; only fill empty name/email (never clobber).
  const existing = await sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle();
  if (!existing.data) {
    await sb.from('users').insert({ phone, name: name || null, email: userEmail || null }).select().single();
  } else {
    const patch: any = {};
    if (name && !(existing.data as any).name) patch.name = name;
    if (userEmail && !(existing.data as any).email) patch.email = userEmail;
    if (Object.keys(patch).length) await sb.from('users').update(patch).eq('phone', phone);
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
  if (regRes.error || !regRes.data) return adminJson({ error: 'insert_failed' }, 500, origin);
  const reg = regRes.data as { id: string };

  await writeAudit(sb, { actor_email: email, action: 'registration.create', target_table: 'registrations', target_id: reg.id, diff: regRes.data });

  if (sendMail && userEmail) {
    try {
      await sendRegistrationConfirmation(env, edition, { name, email: userEmail, passType, days, amountPaid, discount: 0, tier: null });
    } catch (e) { console.error('email_failed', e); }
  }

  return adminJson({ ok: true, registration_id: reg.id }, 200, origin);
}

export async function handleRegPatch(req: Request, env: Env, sb: SupabaseClient, id: string, email: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('registrations').select('id, payment_status, amount_paid').eq('id', id).maybeSingle();
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);

  const patch: any = {};
  if (body.payment_status === 'confirmed' || body.payment_status === 'pending' || body.payment_status === 'cancelled') {
    patch.payment_status = body.payment_status;
  }
  if (Number.isFinite(Number(body.amount_paid))) patch.amount_paid = Number(body.amount_paid);
  if (Object.keys(patch).length === 0) return adminJson({ error: 'no_changes' }, 400, origin);

  const upd = await sb.from('registrations').update(patch).eq('id', id).select().single();
  if (upd.error || !upd.data) return adminJson({ error: 'update_failed' }, 500, origin);

  const diff = diffRows(before.data as any, { ...(before.data as any), ...patch });
  await writeAudit(sb, { actor_email: email, action: 'registration.update', target_table: 'registrations', target_id: id, diff });

  return adminJson({ ok: true, registration: upd.data }, 200, origin);
}
