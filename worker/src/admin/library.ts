// The game-library desk.
//
// Every mutation runs an RPC that locks what it touches, so two members of
// staff working the counter at once cannot hand the same box to two people.
// Nothing here re-implements a rule that lives in the database.
//
// The shape of the desk is deliberately one screen: scan a pass and the reply
// says what that person currently has and therefore what can be done next —
// hand something over, take something back, or neither. Staff never pick a
// mode, because picking the wrong mode is the mistake a queue makes happen.
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Database exceptions the desk can act on, rather than a generic 500. */
const DESK_ERRORS: Record<string, number> = {
  attendee_not_found: 404,
  copy_not_found: 404,
  loan_not_found: 404,
  copy_withdrawn: 409,
  copy_taken: 409,
  copy_on_loan: 409,
  already_borrowing: 409,
  loan_not_open: 409,
  library_last_call: 409,
  note_required: 400,
};

function deskError(message: string): { error: string; status: number } {
  for (const [needle, status] of Object.entries(DESK_ERRORS)) {
    if (message.includes(needle)) return { error: needle, status };
  }
  return { error: 'request_failed', status: 500 };
}

/** What this attendee currently holds — the whole basis of the desk screen. */
export async function loansForAttendee(sb: SupabaseClient, attendeeId: string) {
  const { data, error } = await sb
    .from('library_loans')
    .select('id, status, request_expires_at, due_at, copy_id, library_copies(id, copy_number, library_titles(key, title))')
    .eq('attendee_id', attendeeId)
    .in('status', ['requested', 'checked_out']);
  if (error) return { hold: null, loan: null };

  const rows = (data ?? []) as unknown as Array<{
    id: string; status: string; request_expires_at: string; due_at: string | null; copy_id: string;
    library_copies: { copy_number: number; library_titles: { key: string; title: string } } | null;
  }>;

  const shape = (row: (typeof rows)[number]) => ({
    loan_id: row.id,
    copy_id: row.copy_id,
    copy_number: row.library_copies?.copy_number ?? null,
    title: row.library_copies?.library_titles.title ?? null,
    title_key: row.library_copies?.library_titles.key ?? null,
  });

  // A lapsed hold is still shown, flagged. The desk needs to see it: if the box
  // is still on the shelf the attendee gets it anyway, and staff should not
  // have to hear "but I requested it" with nothing on screen to confirm that.
  const held = rows.find((row) => row.status === 'requested');
  const open = rows.find((row) => row.status === 'checked_out');

  return {
    hold: held
      ? {
        ...shape(held),
        expires_at: held.request_expires_at,
        expired: Date.parse(held.request_expires_at) <= Date.now(),
      }
      : null,
    loan: open
      ? {
        ...shape(open),
        due_at: open.due_at,
        overdue: open.due_at !== null && Date.parse(open.due_at) <= Date.now(),
      }
      : null,
  };
}

export async function handleLibraryCheckout(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { attendee_id?: unknown; copy_id?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }
  const attendeeId = typeof body.attendee_id === 'string' ? body.attendee_id : '';
  const copyId = typeof body.copy_id === 'string' ? body.copy_id : '';
  if (!UUID.test(attendeeId) || !UUID.test(copyId)) {
    return adminJson({ error: 'invalid_body' }, 400, origin);
  }

  const { data, error } = await sb.rpc('check_out_library_copy', {
    p_attendee_id: attendeeId,
    p_copy_id: copyId,
    p_actor: actorEmail,
  });
  if (error) {
    const mapped = deskError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { loan_id: string; due_at: string } | undefined;
  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'library.checkout',
    target_table: 'library_loans',
    target_id: row?.loan_id ?? null,
    diff: { attendee_id: attendeeId, copy_id: copyId, due_at: row?.due_at ?? null },
  });

  return adminJson({ ok: true, loan_id: row?.loan_id, due_at: row?.due_at }, 200, origin);
}

export async function handleLibraryReturn(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { loan_id?: unknown; withdraw_note?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }
  const loanId = typeof body.loan_id === 'string' ? body.loan_id : '';
  if (!UUID.test(loanId)) return adminJson({ error: 'invalid_body' }, 400, origin);
  const note = typeof body.withdraw_note === 'string' && body.withdraw_note.trim().length > 0
    ? body.withdraw_note.trim().slice(0, 500)
    : null;

  const { error } = await sb.rpc('return_library_loan', {
    p_loan_id: loanId,
    p_actor: actorEmail,
    p_withdraw_note: note,
  });
  if (error) {
    const mapped = deskError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: note ? 'library.return_damaged' : 'library.return',
    target_table: 'library_loans',
    target_id: loanId,
    diff: { withdraw_note: note },
  });
  return adminJson({ ok: true, withdrawn: note !== null }, 200, origin);
}

/**
 * Takes a copy off the shelf without a loan involved.
 *
 * The counter is the only place anybody opens these boxes, so it is the only
 * place a missing piece gets noticed. Making staff remember to do it later is
 * the same as not having it.
 */
export async function handleLibraryWithdraw(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { copy_id?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }
  const copyId = typeof body.copy_id === 'string' ? body.copy_id : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  if (!UUID.test(copyId)) return adminJson({ error: 'invalid_body' }, 400, origin);
  if (note.length === 0) return adminJson({ error: 'note_required' }, 400, origin);

  const { error } = await sb.rpc('withdraw_library_copy', {
    p_copy_id: copyId, p_actor: actorEmail, p_note: note,
  });
  if (error) {
    const mapped = deskError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'library.withdraw',
    target_table: 'library_copies',
    target_id: copyId,
    diff: { note },
  });
  return adminJson({ ok: true }, 200, origin);
}

export async function handleLibraryRestore(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { copy_id?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }
  const copyId = typeof body.copy_id === 'string' ? body.copy_id : '';
  if (!UUID.test(copyId)) return adminJson({ error: 'invalid_body' }, 400, origin);

  const { error } = await sb.rpc('restore_library_copy', { p_copy_id: copyId });
  if (error) return adminJson({ error: 'request_failed' }, 500, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'library.restore',
    target_table: 'library_copies',
    target_id: copyId,
    diff: {},
  });
  return adminJson({ ok: true }, 200, origin);
}

/** Gives up on a box that never came back, so the books can be closed. */
export async function handleLibraryLost(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let body: { loan_id?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return adminJson({ error: 'invalid_body' }, 400, origin); }
  const loanId = typeof body.loan_id === 'string' ? body.loan_id : '';
  if (!UUID.test(loanId)) return adminJson({ error: 'invalid_body' }, 400, origin);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null;

  const { error } = await sb.rpc('mark_library_loan_lost', {
    p_loan_id: loanId, p_actor: actorEmail, p_note: note,
  });
  if (error) {
    const mapped = deskError(error.message ?? '');
    return adminJson({ error: mapped.error }, mapped.status, origin);
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'library.lost',
    target_table: 'library_loans',
    target_id: loanId,
    diff: { note },
  });
  return adminJson({ ok: true }, 200, origin);
}

/**
 * Everything currently out, overdue first.
 *
 * Carries a contact number, which is the one place in this feature where
 * personal data reaches a screen — and the reason it does is that a game has
 * walked and somebody has to ring about it. It falls back to the purchaser's
 * phone, because a guest on seat 2 has none of their own.
 */
export async function handleLibraryLoans(
  req: Request,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const overdueOnly = url.searchParams.get('overdue') === '1';

  const { data, error } = await sb.rpc('library_open_loans');
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);

  let rows = (data ?? []) as Array<Record<string, unknown>>;
  if (overdueOnly) rows = rows.filter((row) => row.overdue === true);
  if (query) {
    // The search fallback: a copy can be found and returned without the
    // attendee's phone being present at all.
    rows = rows.filter((row) =>
      String(row.title ?? '').toLowerCase().includes(query)
      || String(row.attendee_name ?? '').toLowerCase().includes(query)
      || String(row.contact_phone ?? '').includes(query));
  }

  return adminJson({
    loans: rows,
    overdue_count: rows.filter((row) => row.overdue === true).length,
  }, 200, origin);
}

/**
 * Titles with at least one free copy, for picking one at the counter.
 *
 * Returns copies rather than a count, because checking out needs a specific
 * copy id even though the boxes are interchangeable to the person holding one.
 */
export async function handleLibraryTitleSearch(
  req: Request,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length < 2) return adminJson({ titles: [] }, 200, origin);

  const titles = await sb
    .from('library_titles')
    .select('id, key, title')
    .ilike('title', `%${query}%`)
    .order('title')
    .limit(20);
  if (titles.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const rows = (titles.data ?? []) as Array<{ id: string; key: string; title: string }>;
  if (rows.length === 0) return adminJson({ titles: [] }, 200, origin);

  const copies = await sb
    .from('library_copies')
    .select('id, title_id, copy_number, status')
    .in('title_id', rows.map((row) => row.id))
    .eq('status', 'available');
  if (copies.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const live = await sb
    .from('library_loans')
    .select('copy_id, status, request_expires_at')
    .in('status', ['requested', 'checked_out']);
  if (live.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const taken = new Set(
    ((live.data ?? []) as Array<{ copy_id: string; status: string; request_expires_at: string }>)
      .filter((row) => row.status === 'checked_out' || Date.parse(row.request_expires_at) > Date.now())
      .map((row) => row.copy_id),
  );

  const byTitle = new Map<string, Array<{ id: string; copy_number: number }>>();
  for (const copy of (copies.data ?? []) as Array<{ id: string; title_id: string; copy_number: number }>) {
    if (taken.has(copy.id)) continue;
    const list = byTitle.get(copy.title_id) ?? [];
    list.push({ id: copy.id, copy_number: copy.copy_number });
    byTitle.set(copy.title_id, list);
  }

  return adminJson({
    titles: rows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      free_copies: (byTitle.get(row.id) ?? []).sort((a, b) => a.copy_number - b.copy_number),
    })),
  }, 200, origin);
}
