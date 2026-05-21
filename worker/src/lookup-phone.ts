// worker/src/lookup-phone.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { fetchGuildStatus } from './bgc-client';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleLookupPhone(req: Request, env: Env): Promise<Response> {
  let phone = '';
  let editionId = '';
  try {
    const body = await req.json<{ phone?: string; edition_id?: string }>();
    phone = sanitizePhone(body.phone);
    editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);

  const sb = serviceClient(env);
  const [userRes, guildRes, regsRes] = await Promise.all([
    sb.from('users').select('phone, name, email').eq('phone', phone).maybeSingle(),
    fetchGuildStatus(env, phone),
    sb
      .from('registrations')
      .select('payment_status')
      .eq('edition_id', editionId)
      .eq('user_phone', phone)
      .neq('payment_status', 'cancelled'),
  ]);

  const user = userRes.data as { phone: string; name: string | null; email: string | null } | null;
  const regs = (regsRes.data ?? []) as Array<{ payment_status: string }>;
  const hasConfirmed = regs.some((r) => r.payment_status === 'confirmed');
  const discountBlocked = guildRes.active && regs.length > 0;

  return jsonResponse({
    user: {
      found: !!user,
      name: user?.name ?? null,
      email: user?.email ?? null,
    },
    guild: guildRes,
    existing_for_edition: {
      count: regs.length,
      has_confirmed: hasConfirmed,
    },
    discount_blocked: discountBlocked,
  });
}
