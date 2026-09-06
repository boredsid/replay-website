// worker/src/promo-preview.ts
// Read-only check behind the public form's "Apply" button. Nothing is reserved
// or recorded here; `/api/register` re-evaluates the code and is the authority
// on what an attendee is actually charged.
import type { Env } from './index';
import { serviceClient } from './supabase';
import { sanitizePhone, parseDays, parsePassType, jsonResponse } from './validation';
import { readPricing, calculateBasePrice } from './pricing';
import { normalizePromoCode, evaluatePromo } from './promo';
import { loadPromoContext } from './promo-lookup';
import { getEditionById } from './editions';
import { publicRequestAllowed } from './rate-limit';

const MAX_TICKET_QUANTITY = 10;

export async function handlePromoPreview(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
  const passType = parsePassType(body.pass_type);
  const days = parseDays(body.days);
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  // The phone is optional: without it the per-person limit cannot be checked
  // here, so `/api/register` remains the only place that enforcement is final.
  const phone = sanitizePhone(body.phone);

  if (!editionId) return jsonResponse({ error: 'invalid edition_id' }, 400);
  if (!passType) return jsonResponse({ error: 'invalid pass_type' }, 400);
  if (!days) return jsonResponse({ error: 'invalid days' }, 400);
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKET_QUANTITY) {
    return jsonResponse({ error: 'invalid quantity' }, 400);
  }

  // Guessing at codes is the risk here, so the per-IP bucket inside
  // publicRequestAllowed does the real work. The subject bucket is keyed on the
  // caller — never on the edition, which every anonymous visitor would share
  // and any one of them could exhaust for everybody.
  const subject = phone || req.headers.get('CF-Connecting-IP') || 'anonymous';
  if (!(await publicRequestAllowed(env, req, 'promo-preview', subject))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const code = normalizePromoCode(body.promo_code);
  if (!code) return jsonResponse({ error: 'promo_not_found' }, 404);

  const edition = await getEditionById(env, editionId);
  if (!edition) return jsonResponse({ error: 'edition not found' }, 404);
  if (edition.registration_status !== 'open') return jsonResponse({ error: 'registration_closed' }, 409);

  const context = await loadPromoContext(serviceClient(env), editionId, code, phone || null);
  if (!context) return jsonResponse({ error: 'promo_lookup_failed' }, 500);

  const pricing = readPricing(edition.pricing);
  const ticketPrice = calculateBasePrice(pricing, passType, days);
  const result = evaluatePromo({
    promo: context.promo,
    ticketPrice,
    quantity,
    passType,
    redemptions: context.redemptions,
  });

  // The floor travels with a min-quantity refusal so the form can say how many
  // tickets the code actually needs rather than "that didn't work".
  if (!result.ok) {
    return jsonResponse({ error: result.reason, min_quantity: context.promo?.min_quantity ?? null }, 404);
  }

  // The rule travels with the acceptance so the form can re-price locally when
  // the attendee changes pass, day, or quantity, the same way it already
  // mirrors the Guild Path calculation.
  const promo = context.promo!;
  return jsonResponse({
    code: result.code,
    message: result.message,
    discount: result.discount,
    rule: {
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      max_discount: promo.max_discount,
      scope: promo.scope,
      pass_type: promo.pass_type,
      min_quantity: promo.min_quantity,
    },
  });
}
