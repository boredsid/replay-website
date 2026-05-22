// worker/src/cancel-registration.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleCancelRegistration(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }
  const registrationId = typeof body.registration_id === 'string' ? body.registration_id : '';
  const phone = sanitizePhone(body.phone);
  if (!registrationId) return jsonResponse({ error: 'invalid registration_id' }, 400);
  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);

  const sb = serviceClient(env);
  const lookup = await sb
    .from('registrations')
    .select('id, user_phone, payment_status')
    .eq('id', registrationId)
    .maybeSingle();
  const reg = lookup.data as { id: string; user_phone: string; payment_status: string } | null;
  if (!reg) return jsonResponse({ error: 'not_found' }, 404);
  if (reg.user_phone !== phone) return jsonResponse({ error: 'forbidden' }, 403);
  if (reg.payment_status === 'cancelled') return jsonResponse({ error: 'already_cancelled' }, 409);

  const { error } = await sb.from('registrations').update({ payment_status: 'cancelled' }).eq('id', registrationId);
  if (error) return jsonResponse({ error: 'update_failed' }, 500);

  return jsonResponse({ ok: true, registration_id: registrationId });
}
