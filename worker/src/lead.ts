// worker/src/lead.ts
import type { Env } from './index';
import { serviceClient } from './supabase';
import { sanitizePhone, parseStepReached, jsonResponse } from './validation';
import { publicRequestAllowed } from './rate-limit';

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
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : null;

  if (!phone) return jsonResponse({ error: 'invalid phone' }, 400);
  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!step) return jsonResponse({ error: 'invalid step_reached' }, 400);
  if (!(await publicRequestAllowed(env, req, 'lead', phone))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const sb = serviceClient(env);
  const editionRow = await sb.from('editions').select('id').eq('id', editionId).maybeSingle();
  if (editionRow.error) return jsonResponse({ error: 'edition_lookup_failed' }, 500);
  if (!editionRow.data) return jsonResponse({ error: 'edition not found' }, 400);

  // The database derives the actual edition from created_at. The supplied
  // edition only proves the request came from a real edition page; after that
  // edition ends, this same upsert becomes the single untagged future lead.
  const upsertRow: any = { edition_id: editionId, phone, step_reached: step };
  if (name) upsertRow.name = name;
  const { error } = await sb.from('leads').upsert(upsertRow, { onConflict: 'edition_id,phone' });
  if (error) return jsonResponse({ error: 'lead_insert_failed' }, 500);

  return jsonResponse({ ok: true });
}
