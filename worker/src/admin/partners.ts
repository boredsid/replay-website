import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';
import type { EditionRow } from '../editions';
import { sendPartnerConfirmation } from '../partner-email';
import {
  parsePartnerPackage,
  partnerAmounts,
  partnerKind,
  readPartnerPricing,
  type PartnerPackageKey,
} from '../partner-pricing';
import { parseDays, sanitizePhone, type Day } from '../validation';
import { adminJson } from './auth';
import { diffRows, writeAudit } from './audit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYMENT_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
const KINDS = ['booth', 'community_engagement'] as const;

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

function validDays(packageKey: PartnerPackageKey, days: Day[]): boolean {
  if (partnerKind(packageKey) === 'booth') {
    return days.length === 2 && days.includes('day1') && days.includes('day2');
  }
  return days.length === 1;
}

function money(value: unknown, field: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid_${field}`);
  return Math.round(amount * 100) / 100;
}

async function getEdition(sb: SupabaseClient, id: string): Promise<EditionRow | null> {
  const result = await sb.from('editions').select('*').eq('id', id).maybeSingle();
  if (result.error) throw new Error('edition_query_failed');
  return (result.data as EditionRow) ?? null;
}

function parsePartnerRow(body: any, edition: EditionRow, previous?: any) {
  const merged = { ...(previous ?? {}), ...(body ?? {}) };
  const editionId = typeof merged.edition_id === 'string' ? merged.edition_id.trim() : '';
  if (!editionId) throw new Error('invalid_edition_id');

  const organizationName = requiredText(merged.organization_name, 160, 'organization_name');
  const contactName = requiredText(merged.contact_name, 120, 'contact_name');
  const phone = sanitizePhone(merged.phone);
  if (!phone) throw new Error('invalid_phone');
  const email = requiredText(merged.email, 254, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('invalid_email');

  const packageKey = parsePartnerPackage(merged.package_key);
  if (!packageKey) throw new Error('invalid_package');
  const days = parseDays(merged.days);
  if (!days || !validDays(packageKey, days)) throw new Error('invalid_days');

  const paymentStatus = PAYMENT_STATUSES.includes(merged.payment_status as PartnerPaymentStatus)
    ? merged.payment_status as PartnerPaymentStatus
    : null;
  if (!paymentStatus) throw new Error('invalid_payment_status');

  const canonical = partnerAmounts(readPartnerPricing(edition.partner_pricing), packageKey);
  const priceContextChanged = Boolean(previous)
    && (previous.package_key !== packageKey || previous.edition_id !== editionId);
  const baseAmount = body?.base_amount !== undefined
    ? money(body.base_amount, 'base_amount')
    : priceContextChanged || !previous
      ? canonical.base
      : money(previous.base_amount, 'base_amount');
  const gstAmount = body?.gst_amount !== undefined
    ? money(body.gst_amount, 'gst_amount')
    : priceContextChanged || !previous
      ? Math.round(baseAmount * readPartnerPricing(edition.partner_pricing).gst_rate * 100) / 100
      : money(previous.gst_amount, 'gst_amount');

  return {
    edition_id: editionId,
    organization_name: organizationName,
    contact_name: contactName,
    phone,
    email,
    website_url: optionalWebsite(merged.website_url),
    gstin: optionalText(merged.gstin, 30, 'gstin')?.toUpperCase() ?? null,
    kind: partnerKind(packageKey),
    package_key: packageKey,
    days,
    details: optionalText(merged.details, 2000, 'details'),
    internal_notes: optionalText(merged.internal_notes, 4000, 'internal_notes'),
    base_amount: baseAmount,
    gst_amount: gstAmount,
    payment_status: paymentStatus,
  };
}

export async function handlePartnerList(req: Request, sb: SupabaseClient, origin: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const editionId = params.get('edition_id')?.trim() ?? '';
  const status = params.get('status');
  const kind = params.get('kind');
  const q = params.get('q')?.trim().toLowerCase() ?? '';
  if (!editionId) return adminJson({ error: 'edition_id_required' }, 400, origin);

  let query = sb
    .from('partners')
    .select('*')
    .eq('edition_id', editionId)
    .order('created_at', { ascending: false });
  if (PAYMENT_STATUSES.includes(status as PartnerPaymentStatus)) query = query.eq('payment_status', status);
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
  return adminJson({ partners }, 200, origin);
}

export async function handlePartnerGet(sb: SupabaseClient, id: string, origin: string): Promise<Response> {
  const result = await sb.from('partners').select('*').eq('id', id).maybeSingle();
  if (result.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!result.data) return adminJson({ error: 'not_found' }, 404, origin);
  return adminJson({ partner: result.data }, 200, origin);
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

  const inserted = await sb
    .from('partners')
    .insert({ ...row, source: { channel: 'admin', by: actorEmail } })
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
  return adminJson({ ok: true, partner: inserted.data }, 200, origin);
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

  let row: ReturnType<typeof parsePartnerRow>;
  try { row = parsePartnerRow(body, edition, previous); }
  catch (error: any) { return adminJson({ error: error.message }, 400, origin); }

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
  if (previous.payment_status !== 'confirmed' && (updated.data as any).payment_status === 'confirmed') {
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

  return adminJson({ ok: true, partner: updated.data, email_sent: emailSent, email_skipped: emailSkipped }, 200, origin);
}
