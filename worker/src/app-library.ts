// Borrowing a game, from the attendee's side.
//
// The catalogue itself never comes through here. All 586 titles ship with the
// app as a static snapshot, so this endpoint answers only the question a
// snapshot cannot: what is out right now. That keeps the payload proportional
// to how many boxes are off the shelf — a few dozen at the busiest moment —
// rather than to the size of the shelf.
//
// None of the arithmetic lives here either. Holding a copy has to be atomic
// against two people tapping at once, so it happens inside
// `request_library_copy`, which locks the copy row. Doing it in the Worker
// would race exactly when it matters.
import type { Env } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './supabase';
import { jsonResponse } from './validation';
import { getCurrentEdition } from './editions';
import { authenticateDevice, type DeviceIdentity } from './attendee-auth';
import { attendeeGateDay } from './attendee-gate';

/** Maps a database exception onto something the app can act on. */
const LIBRARY_ERRORS: Record<string, { error: string; status: number }> = {
  attendee_not_found: { error: 'attendee_not_found', status: 404 },
  no_copy_available: { error: 'no_copy_available', status: 409 },
  already_holding: { error: 'already_holding', status: 409 },
  already_borrowing: { error: 'already_holding', status: 409 },
  library_last_call: { error: 'library_last_call', status: 409 },
};

function mapError(message: string): { error: string; status: number } {
  for (const [needle, mapped] of Object.entries(LIBRARY_ERRORS)) {
    if (message.includes(needle)) return mapped;
  }
  return { error: 'request_failed', status: 500 };
}

async function requireDevice(
  req: Request,
  sb: SupabaseClient,
): Promise<DeviceIdentity | Response> {
  const auth = await authenticateDevice(req, sb);
  if (auth.ok) return auth.identity;
  const status = auth.error === 'query_failed' ? 503 : 401;
  return jsonResponse({ error: auth.error }, status);
}

interface LiveLoanRow {
  id: string;
  status: string;
  request_expires_at: string;
  due_at: string | null;
  library_copies: {
    copy_number: number;
    library_titles: { key: string; title: string };
  } | null;
}

/** This attendee's hold and loan, if they have either. */
async function liveLoans(sb: SupabaseClient, attendeeId: string) {
  const { data, error } = await sb
    .from('library_loans')
    .select('id, status, request_expires_at, due_at, library_copies(copy_number, library_titles(key, title))')
    .eq('attendee_id', attendeeId)
    .in('status', ['requested', 'checked_out']);
  if (error) return { hold: null, loan: null };

  const rows = (data ?? []) as unknown as LiveLoanRow[];
  const shape = (row: LiveLoanRow) => ({
    loan_id: row.id,
    title_key: row.library_copies?.library_titles.key ?? null,
    title: row.library_copies?.library_titles.title ?? null,
    copy_number: row.library_copies?.copy_number ?? null,
  });

  // An expired hold is not a hold. Nothing has swept it yet — expiry is lazy —
  // so it must read as absent here or the app shows a countdown that is over.
  const heldRow = rows.find(
    (row) => row.status === 'requested' && Date.parse(row.request_expires_at) > Date.now(),
  );
  const loanRow = rows.find((row) => row.status === 'checked_out');

  return {
    hold: heldRow ? { ...shape(heldRow), expires_at: heldRow.request_expires_at } : null,
    loan: loanRow
      ? {
        ...shape(loanRow),
        due_at: loanRow.due_at,
        overdue: loanRow.due_at !== null && Date.parse(loanRow.due_at) <= Date.now(),
      }
      : null,
  };
}

/**
 * The shelf, as far as this attendee is concerned.
 *
 * `unavailable` is the inversion people expect to be the other way round:
 * listing what is *out* rather than what is in. At 586 titles and a few dozen
 * loans, the list of absences is two orders of magnitude smaller than the list
 * of presences, and it is the half that actually changes.
 */
export async function handleLibraryState(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  const edition = await getCurrentEdition(env);
  if (!edition) return jsonResponse({ error: 'event_unavailable' }, 503);

  const [gate, unavailable, live] = await Promise.all([
    attendeeGateDay(sb, identity.attendee_id, edition),
    sb.rpc('library_unavailable_keys'),
    liveLoans(sb, identity.attendee_id),
  ]);

  const keys = unavailable.error
    ? []
    : ((unavailable.data ?? []) as Array<string | { library_unavailable_keys: string }>)
      .map((row) => (typeof row === 'string' ? row : row.library_unavailable_keys));

  return jsonResponse({
    can_borrow: gate !== null,
    unavailable: keys,
    hold: live.hold,
    loan: live.loan,
  });
}

export async function handleLibraryRequest(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  let titleKey: string;
  try {
    const body = await req.json() as { title_key?: unknown };
    if (typeof body.title_key !== 'string' || body.title_key.length === 0 || body.title_key.length > 100) {
      return jsonResponse({ error: 'invalid_title' }, 400);
    }
    titleKey = body.title_key;
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const edition = await getCurrentEdition(env);
  if (!edition) return jsonResponse({ error: 'event_unavailable' }, 503);

  // Checked in today, same rule as booking a session, from the same function.
  if ((await attendeeGateDay(sb, identity.attendee_id, edition)) === null) {
    return jsonResponse({ error: 'not_checked_in' }, 403);
  }

  const { data, error } = await sb.rpc('request_library_copy', {
    p_attendee_id: identity.attendee_id,
    p_title_key: titleKey,
  });
  if (error) {
    const mapped = mapError(error.message ?? '');
    return jsonResponse({ error: mapped.error }, mapped.status);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    loan_id: string; copy_id: string; copy_number: number; expires_at: string;
  } | undefined;
  if (!row) return jsonResponse({ error: 'no_copy_available' }, 409);

  return jsonResponse({
    loan_id: row.loan_id,
    copy_number: row.copy_number,
    expires_at: row.expires_at,
  });
}

export async function handleLibraryCancel(req: Request, env: Env): Promise<Response> {
  const sb = serviceClient(env);
  const identity = await requireDevice(req, sb);
  if (identity instanceof Response) return identity;

  const { data, error } = await sb.rpc('cancel_library_request', {
    p_attendee_id: identity.attendee_id,
  });
  if (error) return jsonResponse({ error: 'request_failed' }, 500);
  return jsonResponse({ cancelled: data === true });
}
