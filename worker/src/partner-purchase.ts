import type { Env } from './index';
import type { EditionRow } from './editions';
import { getEditionById } from './editions';
import { publicRequestAllowed } from './rate-limit';
import { serviceClient } from './supabase';
import { jsonResponse, parseDays, sanitizePhone, type Day } from './validation';
import {
  parsePartnerPackage,
  partnerAmounts,
  partnerKind,
  readPartnerPricing,
  type PartnerPackageKey,
} from './partner-pricing';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PartnerInput {
  editionId: string;
  organizationName: string;
  contactName: string;
  phone: string;
  email: string;
  websiteUrl: string | null;
  gstin: string | null;
  packageKey: PartnerPackageKey;
  days: Day[];
  details: string;
}

interface PartnerEvaluation {
  edition: EditionRow;
  amounts: { base: number; gst: number; total: number };
}

interface ExistingPartner {
  id: string;
  edition_id: string;
  organization_name: string;
  contact_name: string;
  phone: string;
  email: string;
  website_url: string | null;
  gstin: string | null;
  package_key: PartnerPackageKey;
  days: Day[];
  details: string | null;
  base_amount: number | string;
  gst_amount: number | string;
  total_amount: number | string;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= max ? text : '';
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  return text.length <= max ? text : undefined;
}

function website(value: unknown): string | null | undefined {
  const text = optionalText(value, 500);
  if (text === null || text === undefined) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function daysMatch(packageKey: PartnerPackageKey, days: Day[]): boolean {
  if (partnerKind(packageKey) === 'booth') {
    return days.length === 2 && days.includes('day1') && days.includes('day2');
  }
  return days.length === 1;
}

async function parsePartnerRequest(req: Request): Promise<{ body: any; input: PartnerInput } | Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid_body' }, 400); }

  const editionId = typeof body.edition_id === 'string' ? body.edition_id.trim() : '';
  const organizationName = requiredText(body.organization_name, 160);
  const contactName = requiredText(body.contact_name, 120);
  const phone = sanitizePhone(body.phone);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const packageKey = parsePartnerPackage(body.package_key);
  const days = parseDays(body.days);
  const websiteUrl = website(body.website_url);
  const gstin = optionalText(body.gstin, 30);
  const details = requiredText(body.details, 2000);

  if (!editionId) return jsonResponse({ error: 'invalid_edition_id' }, 400);
  if (!organizationName) return jsonResponse({ error: 'invalid_organization_name' }, 400);
  if (!contactName) return jsonResponse({ error: 'invalid_contact_name' }, 400);
  if (!phone) return jsonResponse({ error: 'invalid_phone' }, 400);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
  if (!packageKey) return jsonResponse({ error: 'invalid_package' }, 400);
  if (!days || !daysMatch(packageKey, days)) return jsonResponse({ error: 'invalid_days' }, 400);
  if (websiteUrl === undefined) return jsonResponse({ error: 'invalid_website_url' }, 400);
  if (gstin === undefined) return jsonResponse({ error: 'invalid_gstin' }, 400);
  if (!details) return jsonResponse({ error: 'invalid_details' }, 400);

  return {
    body,
    input: {
      editionId,
      organizationName,
      contactName,
      phone,
      email,
      websiteUrl,
      gstin: gstin?.toUpperCase() ?? null,
      packageKey,
      days,
      details,
    },
  };
}

async function evaluatePartner(env: Env, input: PartnerInput): Promise<PartnerEvaluation | Response> {
  const edition = await getEditionById(env, input.editionId);
  const today = new Date().toISOString().slice(0, 10);
  if (!edition || !edition.is_current || !edition.is_published || edition.end_date < today) {
    return jsonResponse({ error: 'partner_sales_closed' }, 409);
  }

  try {
    return {
      edition,
      amounts: partnerAmounts(readPartnerPricing(edition.partner_pricing), input.packageKey),
    };
  } catch {
    return jsonResponse({ error: 'partner_pricing_unavailable' }, 503);
  }
}

function samePartner(existing: ExistingPartner, input: PartnerInput): boolean {
  return existing.edition_id === input.editionId
    && existing.organization_name === input.organizationName
    && existing.contact_name === input.contactName
    && existing.phone === input.phone
    && existing.email === input.email
    && (existing.website_url ?? null) === input.websiteUrl
    && (existing.gstin ?? null) === input.gstin
    && existing.package_key === input.packageKey
    && existing.days.length === input.days.length
    && input.days.every((day) => existing.days.includes(day))
    && (existing.details ?? '') === input.details;
}

function partnerResponse(partner: ExistingPartner): Response {
  return jsonResponse({
    partner_id: partner.id,
    base_amount: Number(partner.base_amount),
    gst_amount: Number(partner.gst_amount),
    final_amount: Number(partner.total_amount),
    payment_required: Number(partner.total_amount) > 0,
  });
}

async function findExistingPartner(sb: ReturnType<typeof serviceClient>, id: string): Promise<ExistingPartner | Response | null> {
  const result = await sb.from('partners').select('*').eq('id', id).maybeSingle();
  if (result.error) return jsonResponse({ error: 'partner_lookup_failed' }, 500);
  return (result.data as ExistingPartner) ?? null;
}

/** Read-only price check. The payment reference is not persisted here. */
export async function handlePartnerPurchasePreview(req: Request, env: Env): Promise<Response> {
  const parsed = await parsePartnerRequest(req);
  if (parsed instanceof Response) return parsed;
  const { input } = parsed;

  if (!(await publicRequestAllowed(env, req, 'partner-preview', input.phone))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const evaluation = await evaluatePartner(env, input);
  if (evaluation instanceof Response) return evaluation;
  return jsonResponse({
    payment_reference: crypto.randomUUID(),
    base_amount: evaluation.amounts.base,
    gst_amount: evaluation.amounts.gst,
    final_amount: evaluation.amounts.total,
    payment_required: evaluation.amounts.total > 0,
  });
}

/** Persists a pending purchase only after the buyer claims the UPI payment. */
export async function handlePartnerPurchase(req: Request, env: Env): Promise<Response> {
  const parsed = await parsePartnerRequest(req);
  if (parsed instanceof Response) return parsed;
  const { body, input } = parsed;
  const partnerId = typeof body.partner_id === 'string' ? body.partner_id.trim() : '';
  const expectedAmount = body.expected_amount;

  if (!UUID_RE.test(partnerId)) return jsonResponse({ error: 'invalid_partner_id' }, 400);
  if (!Number.isFinite(expectedAmount) || expectedAmount < 0) {
    return jsonResponse({ error: 'invalid_expected_amount' }, 400);
  }
  if (!(await publicRequestAllowed(env, req, 'partner-purchase', input.phone))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const sb = serviceClient(env);
  const existing = await findExistingPartner(sb, partnerId);
  if (existing instanceof Response) return existing;
  if (existing) {
    if (!samePartner(existing, input) || existing.payment_status === 'cancelled') {
      return jsonResponse({ error: 'partner_reference_conflict' }, 409);
    }
    return partnerResponse(existing);
  }

  const evaluation = await evaluatePartner(env, input);
  if (evaluation instanceof Response) return evaluation;
  if (Number(expectedAmount) !== evaluation.amounts.total) {
    return jsonResponse({ error: 'amount_changed', final_amount: evaluation.amounts.total }, 409);
  }

  const row = {
    id: partnerId,
    edition_id: input.editionId,
    organization_name: input.organizationName,
    contact_name: input.contactName,
    phone: input.phone,
    email: input.email,
    website_url: input.websiteUrl,
    gstin: input.gstin,
    kind: partnerKind(input.packageKey),
    package_key: input.packageKey,
    days: input.days,
    details: input.details,
    internal_notes: null,
    base_amount: evaluation.amounts.base,
    gst_amount: evaluation.amounts.gst,
    payment_status: 'pending',
    // The website checkout only reaches this point once the buyer has filled
    // the form and claimed the UPI transfer, so the row is born prospective.
    submitted_at: new Date().toISOString(),
    payment_claimed_at: new Date().toISOString(),
    source: { channel: 'website' },
  };
  const inserted = await sb
    .from('partners')
    .insert(row)
    .select('id, edition_id, organization_name, contact_name, phone, email, website_url, gstin, package_key, days, details, base_amount, gst_amount, total_amount, payment_status')
    .single();

  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      const raced = await findExistingPartner(sb, partnerId);
      if (raced instanceof Response) return raced;
      if (raced && samePartner(raced, input) && raced.payment_status !== 'cancelled') {
        return partnerResponse(raced);
      }
    }
    console.error('partner_insert_failed', inserted.error?.message);
    return jsonResponse({ error: 'partner_insert_failed' }, 500);
  }

  return partnerResponse(inserted.data as ExistingPartner);
}
