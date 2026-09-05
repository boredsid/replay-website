// Keeping Cloudflare Access in step with the staff table.
//
// There are two gates. Access decides who can reach admin.replaycon.in at all;
// the staff table decides what they may do once there. Adding a volunteer used
// to mean editing both by hand, in two different places, one of which needs a
// Worker deploy.
//
// This closes the first gate over the second: the staff table is the source of
// truth, and the Access group is rewritten to match it. Rewriting the whole
// group rather than patching one email is deliberate — it is idempotent, and a
// sync that failed yesterday is repaired by the next one rather than leaving
// the two lists quietly diverged.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../index';

const API = 'https://api.cloudflare.com/client/v4';

export type SyncOutcome =
  | { synced: true; members: number }
  /** Not set up yet. The staff table still works; the perimeter is by hand. */
  | { synced: false; reason: 'not_configured' }
  | { synced: false; reason: 'failed'; detail: string };

function configured(env: Env): boolean {
  return Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ACCESS_GROUP_ID);
}

/**
 * Rewrites the Access group to exactly this set of emails.
 *
 * Never throws. A failure here must not undo a staff change that already
 * succeeded — the database is the authority, and the caller reports the
 * divergence rather than pretending the whole operation failed.
 */
/**
 * Where the configured id might live.
 *
 * Cloudflare renamed Access Groups to "Rule groups" and put them on the same
 * dashboard screen as reusable policies, under the same `/policies/` URL. The
 * two are different API objects and an id copied from that screen could be
 * either, with no way to tell by looking. So try both and use whichever
 * answers — the shapes are near enough identical for what this does.
 */
const KINDS = ['groups', 'policies'] as const;

export async function syncAccessGroup(env: Env, emails: readonly string[]): Promise<SyncOutcome> {
  if (!configured(env)) return { synced: false, reason: 'not_configured' };

  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const base = `${API}/accounts/${env.CF_ACCOUNT_ID}/access`;
  const attempts: string[] = [];
  let url = '';
  let found: Record<string, unknown> | null = null;

  try {
    for (const kind of KINDS) {
      const candidate = `${base}/${kind}/${env.CF_ACCESS_GROUP_ID}`;
      const probe = await fetch(candidate, { headers });
      if (probe.ok) {
        const body = await probe.json() as { result?: Record<string, unknown> };
        if (body.result) { url = candidate; found = body.result; break; }
      }
      attempts.push(`${kind} ${probe.status}`);
    }

    if (!found) {
      // Never write an object whose current contents could not be read: that
      // is how rules get deleted by accident.
      return { synced: false, reason: 'failed', detail: `not found as ${attempts.join(', ')}` };
    }

    return await writeMembers(url, headers, found, emails);
  } catch (error) {
    return { synced: false, reason: 'failed', detail: (error as Error).message.slice(0, 120) };
  }
}

/**
 * Replaces only the email rules, leaving everything else exactly as it was.
 *
 * A rule group or a policy can also include a domain, an identity-provider
 * group or a service token, and carries `exclude` and `require` alongside. A
 * policy additionally has a `decision` that decides whether it allows or
 * denies — dropping that would turn an allow rule into something else
 * entirely. Everything read is written back untouched but the addresses.
 */
async function writeMembers(
  url: string,
  headers: Record<string, string>,
  current: Record<string, unknown>,
  emails: readonly string[],
): Promise<SyncOutcome> {
  const include = (current.include ?? []) as Array<Record<string, unknown>>;
  const kept = include.filter((rule) => !('email' in rule));

  const body: Record<string, unknown> = {
    ...current,
    include: [...kept, ...emails.map((email) => ({ email: { email } }))],
  };
  // Server-owned fields; sending them back is at best noise and at worst a
  // rejected request.
  delete body.id;
  delete body.created_at;
  delete body.updated_at;
  delete body.uid;

  const response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { synced: false, reason: 'failed', detail: `write ${response.status} ${detail.slice(0, 140)}` };
  }
  return { synced: true, members: emails.length };
}

/** Reads the staff list and pushes it to Access. Used after every change. */
export async function syncAccessFromStaff(env: Env, sb: SupabaseClient): Promise<SyncOutcome> {
  if (!configured(env)) return { synced: false, reason: 'not_configured' };
  const { data, error } = await sb.from('staff').select('email');
  if (error) return { synced: false, reason: 'failed', detail: 'could not read staff' };
  const emails = ((data ?? []) as Array<{ email: string }>).map((row) => row.email);
  return syncAccessGroup(env, emails);
}
