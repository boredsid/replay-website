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
export async function syncAccessGroup(env: Env, emails: readonly string[]): Promise<SyncOutcome> {
  if (!configured(env)) return { synced: false, reason: 'not_configured' };

  const url = `${API}/accounts/${env.CF_ACCOUNT_ID}/access/groups/${env.CF_ACCESS_GROUP_ID}`;
  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  try {
    // The API requires a name on update, and inventing one would silently
    // rename whatever the group is called in the dashboard.
    const current = await fetch(url, { headers });
    if (!current.ok) {
      return { synced: false, reason: 'failed', detail: `read ${current.status}` };
    }
    const body = await current.json() as { result?: { name?: string } };
    const name = body.result?.name ?? 'REPLAY admin staff';

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name,
        include: emails.map((email) => ({ email: { email } })),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { synced: false, reason: 'failed', detail: `write ${response.status} ${detail.slice(0, 120)}` };
    }
    return { synced: true, members: emails.length };
  } catch (error) {
    return { synced: false, reason: 'failed', detail: (error as Error).message.slice(0, 120) };
  }
}

/** Reads the staff list and pushes it to Access. Used after every change. */
export async function syncAccessFromStaff(env: Env, sb: SupabaseClient): Promise<SyncOutcome> {
  if (!configured(env)) return { synced: false, reason: 'not_configured' };
  const { data, error } = await sb.from('staff').select('email');
  if (error) return { synced: false, reason: 'failed', detail: 'could not read staff' };
  const emails = ((data ?? []) as Array<{ email: string }>).map((row) => row.email);
  return syncAccessGroup(env, emails);
}
