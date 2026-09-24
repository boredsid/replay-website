// worker/src/site-phase-cron.ts
//
// The public site is a static build, and what it says depends on the date:
// before an edition, during it, and after it has ended. A date the build has
// already passed changes nothing until something rebuilds the site, so every
// night at 03:00 in Bengaluru this checks whether today is a morning on which
// the site's phase turns, and if so fires the same deploy hook as the
// console's Rebuild button.
//
// Two mornings per edition: its first day (the site goes `live`) and the day
// after its last (it goes `wrapped`). The phase itself is decided by the build
// (src/lib/site-phase.ts); this only makes sure a build happens on those days.
//
// Design: docs/specs/2026-09-24-between-editions-design.md

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './index';
import { getCurrentEdition } from './editions';
import { istDate } from './display-feed';
import { fireDeployHook } from './admin/rebuild';
import { writeAudit } from './admin/audit';

/** `30 21 * * *` in UTC is 03:00 the next morning in Bengaluru. */
export const PHASE_CRON = '30 21 * * *';

export type PhaseBoundary = 'live' | 'wrapped';

function dayAfter(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Whether `today` (a Bengaluru date) is a morning the site's phase changes. */
export function phaseBoundary(edition: { start_date: string; end_date: string }, today: string): PhaseBoundary | null {
  if (today === edition.start_date) return 'live';
  if (today === dayAfter(edition.end_date)) return 'wrapped';
  return null;
}

/**
 * Cron delivery is at-least-once, so this can run twice on a boundary
 * morning. A second rebuild of the same commit is harmless.
 *
 * A failed hook is logged, not retried: tomorrow's run no longer matches the
 * date, so the fix is the console's Rebuild button.
 */
export async function rebuildOnPhaseBoundary(
  env: Env,
  sb: SupabaseClient,
  now: Date,
): Promise<{ phase: PhaseBoundary | null; rebuilt: boolean }> {
  const edition = await getCurrentEdition(env);
  if (!edition) return { phase: null, rebuilt: false };

  const phase = phaseBoundary(edition, istDate(now));
  if (!phase) return { phase: null, rebuilt: false };

  let rebuilt = false;
  try {
    rebuilt = await fireDeployHook(env);
  } catch (error) {
    console.error('phase_rebuild_hook_failed', error);
  }
  if (!rebuilt) {
    console.error('phase_rebuild_failed', { edition: edition.slug, phase });
    return { phase, rebuilt: false };
  }

  try {
    await writeAudit(sb, {
      actor_email: 'system:phase-cron',
      action: 'site.rebuild',
      target_table: 'site',
      target_id: null,
      diff: { reason: 'phase', phase, edition: edition.slug },
    });
  } catch (error) {
    // The rebuild happened; a missing audit row is not worth failing over.
    console.error('phase_rebuild_audit_failed', error);
  }
  return { phase, rebuilt: true };
}
