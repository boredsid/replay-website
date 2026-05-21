// worker/src/lead.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { sanitizePhone, parseStepReached, jsonResponse } from './validation';

const RATE_LIMIT_MS = 2000;
let rateLimitMap = new Map<string, number>();

export function _resetLeadRateLimit() {
  rateLimitMap = new Map();
}

export async function handleLead(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }
  const phone = sanitizePhone(body.phone);
  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const step = parseStepReached(body.step_reached);
  const name = typeof body.name === 'string' ? body.name.trim() : null;

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!step) return jsonResponse({ error: 'invalid step_reached' }, 400);

  const key = `${editionId}:${phone}`;
  const now = Date.now();
  const last = rateLimitMap.get(key);
  if (last && now - last < RATE_LIMIT_MS) {
    return jsonResponse({ ok: true });
  }
  rateLimitMap.set(key, now);

  const sb = serviceClient(env);
  const editionRow = await sb.from('editions').select('id').eq('id', editionId).maybeSingle();
  if (!editionRow.data) return jsonResponse({ error: 'edition not found' }, 400);

  const existing = await sb
    .from('leads')
    .select('id, converted_at')
    .eq('edition_id', editionId)
    .eq('phone', phone)
    .maybeSingle();
  if ((existing.data as any)?.converted_at) {
    return jsonResponse({ ok: true });
  }

  const upsertRow: any = { edition_id: editionId, phone, step_reached: step };
  if (name) upsertRow.name = name;
  const { error } = await sb.from('leads').upsert(upsertRow, { onConflict: 'edition_id,phone' });
  if (error) return jsonResponse({ error: 'lead_insert_failed' }, 500);

  return jsonResponse({ ok: true });
}
