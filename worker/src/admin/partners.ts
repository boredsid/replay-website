import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import type { EditionRow } from '../editions';
import { sendPartnerConfirmation } from '../partner-email';
import { generateInviteToken, inviteUrl } from '../partner-invite';
import {
  PARTNER_OFFERS,
  parsePartnerOffer,
  partnerOfferDays,
  partnerOfferKind,
  validOfferDays,
  type PartnerOfferKey,
} from '../partner-offers';
import { partnerAmounts, readPartnerPricing, type PartnerPackageKey } from '../partner-pricing';
import { parseDays, sanitizePhone, type Day } from '../validation';
import { adminJson } from './auth';
import { diffRows, writeAudit } from './audit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYMENT_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
const KINDS = ['booth', 'community_engagement', 'sponsorship'] as const;
const STAGES = ['lead', 'prospective', 'confirmed', 'cancelled'] as const;

type PartnerPaymentStatus = typeof PAYMENT_STATUSES[number];

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

function optionalWebsite(value: unknown): string | null {
  const text = optionalText(value, 500, 'website_url');
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new Error('invalid_website_url');
  }
}

function money(value: unknown, field: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid_${field}`);
  return Math.round(amount * 100) / 100;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid_${field}`);
  return parsed.toISOString();
}

async function getEdition(sb: SupabaseClient, id: string): Promise<EditionRow | null> {
  const result = await sb.from('editions').select('*').eq('id', id).maybeSingle();
  if (result.error) throw new Error('edition_query_failed');
  return (result.data as EditionRow) ?? null;
}

/** The price the edition carries, for the four self-serve packages only. */
function pricedAmounts(edition: EditionRow, offerKey: PartnerOfferKey) {
  if (!PARTNER_OFFERS[offerKey].priced) return null;
  return partnerAmounts(readPartnerPricing(edition.partner_pricing), offerKey as PartnerPackageKey);
}

function withInviteUrl(env: Env, partner: any) {
  return { ...partner, invite_url: partner?.invite_token ? inviteUrl(env, partner.invite_token) : null };
}

/**
 * A lead has an organisation, an offer and a price and nothing else — the rest
 * is the partner's to fill in through their link. Every other row must be
 * complete.
 */
function parsePartnerRow(body: any, edition: EditionRow, previous?: any) {
  const merged = { ...(previous ?? {}), ...(body ?? {}) };
  const editionId = typeof merged.edition_id === 'string' ? merged.edition_id.trim() : '';
  if (!editionId) throw new Error('invalid_edition_id');

  const isLead = Boolean(previous) && !previous.submitted_at;
  const organizationName = requiredText(merged.organization_name, 160, 'organization_name');
  const contactName = isLead
    ? optionalText(merged.contact_name, 120, 'contact_name')
    : requiredText(merged.contact_name, 120, 'contact_name');
  const rawPhone = merged.phone === null || merged.phone === undefined || merged.phone === '' ? '' : sanitizePhone(merged.phone);
  if (!rawPhone && !isLead) throw new Error('invalid_phone');
  const phone = rawPhone || null;
  const emailInput = isLead
    ? optionalText(merged.email, 254, 'email')
    : requiredText(merged.email, 254, 'email');
  const email = emailInput ? emailInput.toLowerCase() : null;
  if (email && !EMAIL_RE.test(email)) throw new Error('invalid_email');

  const offerKey = parsePartnerOffer(merged.package_key);
  if (!offerKey) throw new Error('invalid_package');
  let days: Day[] = [];
  if (Array.isArray(merged.days) && merged.days.length > 0) {
    const parsed = parseDays(merged.days);
    if (!parsed || !validOfferDays(offerKey, parsed)) throw new Error('invalid_days');
    days = parsed;
  } else if (!isLead) {
    throw new Error('invalid_days');
  }

  const paymentStatus = PAYMENT_STATUSES.includes(merged.payment_status as PartnerPaymentStatus)
    ? merged.payment_status as PartnerPaymentStatus
    : null;
  if (!paymentStatus) throw new Error('invalid_payment_status');

  const canonical = pricedAmounts(edition, offerKey);
  const priceContextChanged = Boolean(previous)
    && (previous.package_key !== offerKey || previous.edition_id !== editionId);
  const inheritPrevious = Boolean(previous) && !priceContextChanged;
  let baseAmount: number;
  if (body?.base_amount !== undefined) baseAmount = money(body.base_amount, 'base_amount');
  else if (inheritPrevious) baseAmount = money(previous.base_amount, 'base_amount');
  else if (canonical) baseAmount = canonical.base;
  else throw new Error('invalid_base_amount');

  const gstRate = readPartnerPricing(edition.partner_pricing).gst_rate;
  let gstAmount: number;
  if (body?.gst_amount !== undefined) gstAmount = money(body.gst_amount, 'gst_amount');
  else if (inheritPrevious) gstAmount = money(previous.gst_amount, 'gst_amount');
  else gstAmount = Math.round(baseAmount * gstRate * 100) / 100;

  return {
    edition_id: editionId,
    organization_name: organizationName,
    contact_name: contactName,
    phone,
    email,
    website_url: optionalWebsite(merged.website_url),
    gstin: optionalText(merged.gstin, 30, 'gstin')?.toUpperCase() ?? null,
    kind: partnerOfferKind(offerKey),
    package_key: offerKey,
    days,
    details: optionalText(merged.details, 2000, 'details'),
    internal_notes: optionalText(merged.internal_notes, 4000, 'internal_notes'),
    base_amount: baseAmount,
    gst_amount: gstAmount,
    payment_status: paymentStatus,
  };
}

export async function handlePartnerList(req: Request, env: Env, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const editionId = params.get('edition_id')?.trim() ?? '';
  const status = params.get('status');
  const stage = params.get('stage');
  const kind = params.get('kind');
  const q = params.get('q')?.trim().toLowerCase() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);

  let query = sb
    .from('partners')
    .select('*')
    .eq('edition_id', editionId)
    .order('created_at', { ascending: false });
  if (PAYMENT_STATUSES.includes(status as PartnerPaymentStatus)) query = query.eq('payment_status', status);
  if (STAGES.includes(stage as typeof STAGES[number])) query = query.eq('stage', stage);
  if (KINDS.includes(kind as typeof KINDS[number])) query = query.eq('kind', kind);
  const result = await query;
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);

  let partners = (result.data ?? []) as any[];
  if (q) {
    partners = partners.filter((partner) => [
      partner.organization_name,
      partner.contact_name,
      partner.phone,
      partner.email,
    ].some((value) => String(value ?? '').toLowerCase().includes(q)));
  }
  return adminJson({ partners: partners.map((partner) => withInviteUrl(env, partner)) }, 200, origin);
}

export async function handlePartnerGet(env: Env, sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const result = await sb.from('partners').select('*').eq('id', id).maybeSingle();
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!result.data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ partner: withInviteUrl(env, result.data) }, 200, origin);
}

/**
 * POST /api/admin/partners/invites — everything an admin knows before talking
 * money: who the partner is, what they are being sold, and what it costs. The
 * row starts as a lead and the returned link is what gets sent to them.
 */
export async function handlePartnerInviteCreate(req: Request, env: Env, sb: SupabaseClient, actorEmail: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const editionId = typeof body.edition_id === 'string' ? body.edition_id.trim() : '';
  if (!editionId) return adminJson({ error: 'invalid_edition_id' }, 400, origin);
  let edition: EditionRow | null;
  try { edition = await getEdition(sb, editionId); }
  catch { return adminJson({ error: 'edition_query_failed' }, 500, origin); }
  if (!edition) return adminJson({ error: 'edition_not_found' }, 404, origin);

  let row: any;
  let expiresAt: string | null;
  try {
    const offerKey = parsePartnerOffer(body.package_key);
    if (!offerKey) throw new Error('invalid_package');
    const organizationName = requiredText(body.organization_name, 160, 'organization_name');
    const canonical = pricedAmounts(edition, offerKey);
    if (body.base_amount === undefined && !canonical) throw new Error('invalid_base_amount');
    const baseAmount = body.base_amount === undefined ? (canonical as { base: number }).base : money(body.base_amount, 'base_amount');
    const gstRate = readPartnerPricing(edition.partner_pricing).gst_rate;
    const gstAmount = body.gst_amount === undefined
      ? Math.round(baseAmount * gstRate * 100) / 100
      : money(body.gst_amount, 'gst_amount');
    // Booths and sponsorships are always the full weekend, so the days are
    // known up front. A community engagement's day is the partner's to pick.
    const days = partnerOfferDays(offerKey) === 'weekend'
      ? (['day1', 'day2'] as Day[])
      : body.day === 'day1' || body.day === 'day2'
        ? [body.day as Day]
        : [];
    expiresAt = optionalTimestamp(body.expires_at, 'expires_at');

    row = {
      edition_id: editionId,
      organization_name: organizationName,
      contact_name: null,
      phone: null,
      email: null,
      website_url: null,
      gstin: null,
      kind: partnerOfferKind(offerKey),
      package_key: offerKey,
      days,
      details: null,
      internal_notes: optionalText(body.internal_notes, 4000, 'internal_notes'),
      base_amount: baseAmount,
      gst_amount: gstAmount,
      payment_status: 'pending',
      invite_token: generateInviteToken(),
      invite_created_by: actorEmail,
      invite_expires_at: expiresAt,
      submitted_at: null,
      payment_claimed_at: null,
      source: { channel: 'invite', by: actorEmail },
    };
  } catch (error: any) {
    return adminJson({ error: error.message }, 400, origin);
  }

  const inserted = await sb.from('partners').insert(row).select().single();
  if (inserted.error || !inserted.data) {
    console.error('partner_invite_insert_failed', inserted.error?.message);
    return adminJson({ error: 'insert_failed' }, 500, origin);
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'partner.invite',
    target_table: 'partners',
    target_id: (inserted.data as any).id,
    diff: { ...(inserted.data as any), invite_token: '[redacted]' },
  });

  const partner = withInviteUrl(env, inserted.data);
  return adminJson({ ok: true, partner, invite_url: partner.invite_url }, 200, origin);
}

export async function handlePartnerCreate(req: Request, env: Env, sb: SupabaseClient, actorEmail: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const editionId = typeof body.edition_id === 'string' ? body.edition_id.trim() : '';
  if (!editionId) return adminJson({ error: 'invalid_edition_id' }, 400, origin);
  let edition: EditionRow | null;
  try { edition = await getEdition(sb, editionId); }
  catch { return adminJson({ error: 'edition_query_failed' }, 500, origin); }
  if (!edition) return adminJson({ error: 'edition_not_found' }, 404, origin);

  let row: ReturnType<typeof parsePartnerRow>;
  try { row = parsePartnerRow({ payment_status: 'pending', ...body }, edition); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  // An admin adding a partner by hand is transcribing a conversation that has
  // already happened, so the row skips straight past the lead stage.
  const inserted = await sb
    .from('partners')
    .insert({ ...row, submitted_at: new Date().toISOString(), source: { channel: 'admin', by: actorEmail } })
    .select()
    .single();
  if (inserted.error || !inserted.data) return adminJson({ error: 'insert_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'partner.create',
    target_table: 'partners',
    target_id: (inserted.data as any).id,
    diff: inserted.data,
  });
  return adminJson({ ok: true, partner: withInviteUrl(env, inserted.data) }, 200, origin);
}

export async function handlePartnerPatch(req: Request, env: Env, sb: SupabaseClient, id: string, actorEmail: string, origin: string): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return adminJson({ error: 'invalid_body' }, 400, origin); }

  const before = await sb.from('partners').select('*').eq('id', id).maybeSingle();
  if (before.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!before.data) return adminJson({ error: 'not_found' }, 404, origin);
  const previous = before.data as any;

  const editionId = typeof body.edition_id === 'string' ? body.edition_id.trim() : previous.edition_id;
  let edition: EditionRow | null;
  try { edition = await getEdition(sb, editionId); }
  catch { return adminJson({ error: 'edition_query_failed' }, 500, origin); }
  if (!edition) return adminJson({ error: 'edition_not_found' }, 404, origin);

  let row: ReturnType<typeof parsePartnerRow> & { submitted_at?: string; invite_expires_at?: string | null };
  try {
    row = parsePartnerRow(body, edition, previous);
    if (body.expires_at !== undefined) row.invite_expires_at = optionalTimestamp(body.expires_at, 'expires_at');
  } catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

  // Filling a lead's details in by hand is the same event as the partner
  // filling them in through their link: it makes them a prospective partner.
  if (!previous.submitted_at && row.contact_name && row.phone && row.email && row.days.length > 0) {
    row.submitted_at = new Date().toISOString();
  }

  const updated = await sb.from('partners').update(row).eq('id', id).select().single();
  if (updated.error || !updated.data) return adminJson({ error: 'update_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'partner.update',
    target_table: 'partners',
    target_id: id,
    diff: diffRows(previous, { ...previous, ...row }),
  });

  let emailSent = false;
  let emailSkipped: 'failed' | null = null;
  const confirmedNow = previous.payment_status !== 'confirmed' && (updated.data as any).payment_status === 'confirmed';
  if (confirmedNow && (updated.data as any).email) {
    const partner = updated.data as any;
    try {
      await sendPartnerConfirmation(env, edition, {
        organizationName: partner.organization_name,
        contactName: partner.contact_name,
        email: partner.email,
        packageKey: partner.package_key,
        days: partner.days,
        baseAmount: Number(partner.base_amount),
        gstAmount: Number(partner.gst_amount),
        totalAmount: Number(partner.total_amount),
        details: partner.details,
      });
      emailSent = true;
    } catch (error) {
      console.error('partner_email_failed', error);
      emailSkipped = 'failed';
    }
  }

  return adminJson({ ok: true, partner: withInviteUrl(env, updated.data), email_sent: emailSent, email_skipped: emailSkipped }, 200, origin);
}
