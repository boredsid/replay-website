// worker/src/pass-status.ts
//
// Machine-to-machine endpoint for the BGC worker: "does this phone hold a
// REPLAY pass?". Mirrors BGC's /api/guild-status in the other direction and
// shares the same REPLAY_TO_BGC_SECRET bearer token.
//
// Only *confirmed* registrations for the latest edition count. Pending and
// cancelled registrations are not passes.
import type { Env } from './index';
import { serviceClient } from './supabase';
import { getLatestEdition } from './editions';
import { sanitizePhone, jsonResponse } from './validation';

export interface PassStatus {
  has_pass: boolean;
  edition_slug: string | null;
  edition_name: string | null;
  pass_type: 'oneshot' | 'campaign' | null;
  days: string[];
}

const NO_PASS: PassStatus = {
  has_pass: false,
  edition_slug: null,
  edition_name: null,
  pass_type: null,
  days: [],
};

export async function handlePassStatus(req: Request, env: Env): Promise<Response> {
  const expected = env.REPLAY_TO_BGC_SECRET;
  const auth = req.headers.get('Authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let phone = '';
  try {
    const body = await req.json<{ phone?: string }>();
    phone = sanitizePhone(body.phone);
  } catch {
    return jsonResponse(NO_PASS);
  }
  if (!phone) return jsonResponse(NO_PASS);

  const edition = await getLatestEdition(env);
  if (!edition) return jsonResponse(NO_PASS);

  const editionInfo = { edition_slug: edition.slug, edition_name: edition.name };

  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('registrations')
    .select('pass_type, days')
    .eq('edition_id', edition.id)
    .eq('user_phone', phone)
    .eq('payment_status', 'confirmed');
  if (error) return jsonResponse({ error: 'lookup_failed' }, 500);

  const regs = (data ?? []) as Array<{ pass_type: 'oneshot' | 'campaign'; days: string[] | null }>;
  if (regs.length === 0) return jsonResponse({ ...NO_PASS, ...editionInfo });

  // Someone can hold more than one registration; report the strongest pass.
  const best = regs.find((r) => r.pass_type === 'campaign') ?? regs[0];
  const days = [...new Set(regs.flatMap((r) => r.days ?? []))].sort();

  return jsonResponse({
    has_pass: true,
    ...editionInfo,
    pass_type: best.pass_type,
    days,
  } satisfies PassStatus);
}
