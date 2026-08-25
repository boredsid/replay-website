import type { Env } from './index';
import { getEditionById } from './editions';
import { editionOrdinal, shortDateRange } from './format';
import {
  PARTNER_OFFER_LABELS,
  partnerOfferDays,
  partnerOfferKind,
  validOfferDays,
  type PartnerOfferKey,
} from './partner-offers';
import { publicRequestAllowed } from './rate-limit';
import { serviceClient } from './supabase';
import { jsonResponse, sanitizePhone, type Day } from './validation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-z0-9]{24,64}$/;

export type PartnerStage = 'lead' | 'prospective' | 'confirmed' | 'cancelled';

export interface PartnerInviteRow {
  id: string;
  edition_id: string;
  organization_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  gstin: string | null;
  package_key: PartnerOfferKey;
  days: Day[];
  details: string | null;
  base_amount: number | string;
  gst_amount: number | string;
  total_amount: number | string;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  stage: PartnerStage;
  invite_token: string | null;
  invite_expires_at: string | null;
  submitted_at: string | null;
  payment_claimed_at: string | null;
}

/** URL-safe, unguessable, and short enough to paste into a WhatsApp message. */
export function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

export function inviteUrl(env: Env, token: string): string {
  const site = (env.REPLAY_SITE_URL || 'https://replaycon.in').replace(/\/+$/, '');
  return `${site}/partner/?t=${encodeURIComponent(token)}`;
}

function expired(invite: PartnerInviteRow): boolean {
  return Boolean(invite.invite_expires_at) && new Date(invite.invite_expires_at as string).getTime() < Date.now();
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

async function loadInvite(env: Env, token: string): Promise<PartnerInviteRow | Response | null> {
  const sb = serviceClient(env);
  const result = await sb.from('partners').select('*').eq('invite_token', token).maybeSingle();
  if (result.error) return jsonResponse({ error: 'invite_lookup_failed' }, 500);
  return (result.data as PartnerInviteRow) ?? null;
}

/**
 * What the partner behind the link is allowed to see. Deliberately excludes
 * `internal_notes` and anything about other partners.
 */
async function invitePayload(env: Env, invite: PartnerInviteRow) {
  const edition = await getEditionById(env, invite.edition_id);
  const ordinal = edition ? editionOrdinal(edition.slug) : '';
  const total = Number(invite.total_amount);
  return {
    organization_name: invite.organization_name,
    offer_key: invite.package_key,
    offer_label: PARTNER_OFFER_LABELS[invite.package_key],
    kind: partnerOfferKind(invite.package_key),
    days_rule: partnerOfferDays(invite.package_key),
    days: invite.days ?? [],
    stage: invite.stage,
    contact_name: invite.contact_name,
    phone: invite.phone,
    email: invite.email,
    website_url: invite.website_url,
    gstin: invite.gstin,
    details: invite.details,
    base_amount: Number(invite.base_amount),
    gst_amount: Number(invite.gst_amount),
    total_amount: total,
    payment_required: total > 0,
    payment_claimed: Boolean(invite.payment_claimed_at),
    payment_reference: invite.id,
    edition: edition
      ? {
          name: (ordinal ? `REPLAY ${ordinal}` : 'REPLAY').trim(),
          venue: edition.venue,
          start_date: edition.start_date,
          end_date: edition.end_date,
          date_range: shortDateRange(edition.start_date, edition.end_date),
        }
      : null,
  };
}

/** GET /api/partner-invite/:token — renders the partner's own link. */
export async function handlePartnerInviteGet(req: Request, env: Env, token: string): Promise<Response> {
  if (!TOKEN_RE.test(token)) return jsonResponse({ error: 'invite_not_found' }, 404);
  if (!(await publicRequestAllowed(env, req, 'partner-invite', token))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const invite = await loadInvite(env, token);
  if (invite instanceof Response) return invite;
  if (!invite) return jsonResponse({ error: 'invite_not_found' }, 404);
  if (expired(invite) && invite.stage === 'lead') return jsonResponse({ error: 'invite_expired' }, 410);

  return jsonResponse({ invite: await invitePayload(env, invite) });
}

/**
 * POST /api/partner-invite/:token — the partner fills in everything the admin
 * could not know. Amounts are never taken from the request: the link's price
 * is whatever the admin agreed, and only an admin can change it.
 */
export async function handlePartnerInviteSubmit(req: Request, env: Env, token: string): Promise<Response> {
  if (!TOKEN_RE.test(token)) return jsonResponse({ error: 'invite_not_found' }, 404);

  let body: any;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'invalid_body' }, 400); }

  const contactName = requiredText(body.contact_name, 120);
  const phone = sanitizePhone(body.phone);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const websiteUrl = website(body.website_url);
  const gstin = optionalText(body.gstin, 30);
  const details = requiredText(body.details, 2000);

  if (!contactName) return jsonResponse({ error: 'invalid_contact_name' }, 400);
  if (!phone) return jsonResponse({ error: 'invalid_phone' }, 400);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return jsonResponse({ error: 'invalid_email' }, 400);
  if (websiteUrl === undefined) return jsonResponse({ error: 'invalid_website_url' }, 400);
  if (gstin === undefined) return jsonResponse({ error: 'invalid_gstin' }, 400);
  if (!details) return jsonResponse({ error: 'invalid_details' }, 400);

  if (!(await publicRequestAllowed(env, req, 'partner-invite-submit', token))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const invite = await loadInvite(env, token);
  if (invite instanceof Response) return invite;
  if (!invite) return jsonResponse({ error: 'invite_not_found' }, 404);
  if (invite.stage === 'cancelled') return jsonResponse({ error: 'invite_cancelled' }, 409);
  if (invite.stage === 'confirmed') return jsonResponse({ error: 'invite_already_confirmed' }, 409);
  if (expired(invite) && invite.stage === 'lead') return jsonResponse({ error: 'invite_expired' }, 410);

  const days = partnerOfferDays(invite.package_key) === 'weekend'
    ? (['day1', 'day2'] as Day[])
    : body.day === 'day1' || body.day === 'day2'
      ? [body.day as Day]
      : null;
  if (!days || !validOfferDays(invite.package_key, days)) return jsonResponse({ error: 'invalid_days' }, 400);

  const sb = serviceClient(env);
  const updated = await sb
    .from('partners')
    .update({
      contact_name: contactName,
      phone,
      email,
      website_url: websiteUrl,
      gstin: gstin?.toUpperCase() ?? null,
      days,
      details,
      submitted_at: invite.submitted_at ?? new Date().toISOString(),
    })
    .eq('id', invite.id)
    .select('*')
    .single();

  if (updated.error || !updated.data) {
    console.error('partner_invite_submit_failed', updated.error?.message);
    return jsonResponse({ error: 'invite_submit_failed' }, 500);
  }

  return jsonResponse({ invite: await invitePayload(env, updated.data as PartnerInviteRow) });
}

/**
 * POST /api/partner-invite/:token/payment-claimed — the partner says the UPI
 * transfer is done. It stays pending until an admin verifies the money.
 */
export async function handlePartnerInvitePaymentClaimed(req: Request, env: Env, token: string): Promise<Response> {
  if (!TOKEN_RE.test(token)) return jsonResponse({ error: 'invite_not_found' }, 404);
  if (!(await publicRequestAllowed(env, req, 'partner-invite-paid', token))) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const invite = await loadInvite(env, token);
  if (invite instanceof Response) return invite;
  if (!invite) return jsonResponse({ error: 'invite_not_found' }, 404);
  if (!invite.submitted_at) return jsonResponse({ error: 'invite_not_submitted' }, 409);
  if (invite.stage === 'cancelled') return jsonResponse({ error: 'invite_cancelled' }, 409);
  if (invite.payment_claimed_at || invite.stage === 'confirmed') {
    return jsonResponse({ invite: await invitePayload(env, invite) });
  }

  const sb = serviceClient(env);
  const updated = await sb
    .from('partners')
    .update({ payment_claimed_at: new Date().toISOString() })
    .eq('id', invite.id)
    .select('*')
    .single();

  if (updated.error || !updated.data) {
    console.error('partner_invite_claim_failed', updated.error?.message);
    return jsonResponse({ error: 'invite_claim_failed' }, 500);
  }

  return jsonResponse({ invite: await invitePayload(env, updated.data as PartnerInviteRow) });
}
