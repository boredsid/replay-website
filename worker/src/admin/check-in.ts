// Kiosk check-in.
//
// Staff-only, inside the existing Cloudflare Access perimeter. There is no
// attendee-facing write path here: the app displays check-in state, it never
// records it, which is what lets a checked-in attendee be treated as physically
// present.
//
// The desk asks every arrival for three things — the purchaser's phone to search
// on, and their own name and number, which are written onto the seat as part of
// checking them in rather than as a later edit. That is what turns anonymous
// guest seats into a real attendee list.
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';
import { getCurrentEdition } from '../editions';
import { editionDayForToday } from './pairing';
import {
  currentState,
  hasArrivedOn,
  lastEventPerDay,
  type CheckInEvent,
  type EventDay,
  type EventKind,
} from './check-in-state';

const DAYS: readonly EventDay[] = ['day1', 'day2'];
const KINDS: readonly EventKind[] = ['in', 'out'];
const SEARCH_LIMIT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits only, so "+91 98765 43210" and "9876543210" find the same person. */
export function normalizePhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '').slice(-10) : '';
}

/** The desk never sees a full number it did not already type. */
export function maskPhone(phone: string | null): string | null {
  return phone && phone.length >= 4 ? `••••${phone.slice(-4)}` : null;
}

export function seatLabel(displayName: string | null, seatIndex: number): string {
  const named = displayName?.trim();
  return named || `Guest ${seatIndex}`;
}

interface AttendeeRow {
  id: string;
  seat_index: number;
  display_name: string | null;
  phone: string | null;
  is_purchaser: boolean;
  registration_id: string;
}

interface RegistrationRow {
  id: string;
  user_phone: string;
  pass_type: string;
  days: EventDay[];
  seats: number;
}

type AttendeeEvent = CheckInEvent & { attendee_id: string };

function eventsFor(all: readonly AttendeeEvent[], attendeeId: string): CheckInEvent[] {
  return all.filter((e) => e.attendee_id === attendeeId);
}

/**
 * Search the desk runs on arrival.
 *
 * Matches three ways: the purchaser's phone (the primary path), an attendee's
 * own phone, and an attendee name. The last two exist for the guest who turns up
 * alone and does not know who bought the ticket — without them the fallback is
 * improvisation at the door.
 *
 * Results group by registration, because day validity is a property of the
 * purchase: one registration may cover both days and another only day 1.
 */
export async function handleCheckInSearch(
  req: Request,
  env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const raw = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (raw.length < 2) return adminJson({ registrations: [] }, 200, origin);

  const edition = await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_current_edition' }, 503, origin);

  const digits = normalizePhone(raw);
  const registrationIds = new Set<string>();

  if (digits.length >= 4) {
    const byPurchaser = await sb
      .from('registrations')
      .select('id')
      .eq('edition_id', edition.id)
      .eq('payment_status', 'confirmed')
      .like('user_phone', `%${digits}%`)
      .limit(SEARCH_LIMIT);
    if (byPurchaser.error) return adminJson({ error: 'query_failed' }, 500, origin);
    for (const row of byPurchaser.data ?? []) registrationIds.add((row as { id: string }).id);
  }

  // An attendee's own details, captured at a previous check-in.
  const attendeeMatch = sb
    .from('attendees')
    .select('registration_id')
    .eq('edition_id', edition.id)
    .limit(SEARCH_LIMIT);
  const byAttendee = digits.length >= 4
    ? await attendeeMatch.like('phone', `%${digits}%`)
    : await attendeeMatch.ilike('display_name', `${raw}%`);
  if (byAttendee.error) return adminJson({ error: 'query_failed' }, 500, origin);
  for (const row of byAttendee.data ?? []) {
    registrationIds.add((row as { registration_id: string }).registration_id);
  }

  if (registrationIds.size === 0) return adminJson({ registrations: [] }, 200, origin);
  const ids = [...registrationIds].slice(0, SEARCH_LIMIT);

  const [regs, attendees] = await Promise.all([
    sb.from('registrations')
      .select('id, user_phone, pass_type, days, seats')
      .in('id', ids)
      .eq('payment_status', 'confirmed'),
    sb.from('attendees')
      .select('id, seat_index, display_name, phone, is_purchaser, registration_id')
      .in('registration_id', ids)
      .order('seat_index', { ascending: true }),
  ]);
  if (regs.error || attendees.error) return adminJson({ error: 'query_failed' }, 500, origin);

  const attendeeRows = (attendees.data ?? []) as AttendeeRow[];
  // Which event day today is, or null outside the event; gates pairing below.
  const today = editionDayForToday(edition as unknown as { start_date: string; end_date: string });
  const events = await loadEvents(sb, attendeeRows.map((a) => a.id), origin);
  if (events instanceof Response) return events;

  const confirmed = new Set(((regs.data ?? []) as RegistrationRow[]).map((r) => r.id));

  const payload = ((regs.data ?? []) as RegistrationRow[]).map((reg) => ({
    registration_id: reg.id,
    purchaser_phone_masked: maskPhone(reg.user_phone),
    pass_type: reg.pass_type,
    days: reg.days,
    seats: reg.seats,
    attendees: attendeeRows
      .filter((a) => a.registration_id === reg.id)
      .map((a) => ({
        attendee_id: a.id,
        seat_index: a.seat_index,
        name: seatLabel(a.display_name, a.seat_index),
        has_name: Boolean(a.display_name?.trim()),
        phone_masked: maskPhone(a.phone),
        has_phone: Boolean(a.phone),
        is_purchaser: a.is_purchaser,
        state: currentState(eventsFor(events, a.id)),
        // The row undo would cancel on each day, so the desk can reverse a
        // mistake without a second lookup. Null means nothing to undo.
        last_event: lastEventPerDay(eventsFor(events, a.id)),
        // Whether a pairing code can be issued right now. Computed here so the
        // button is right rather than optimistic — the endpoint refuses anyway,
        // but a button that fails on press teaches staff to distrust the screen.
        can_pair: today !== null && hasArrivedOn(eventsFor(events, a.id), today),
        // Days this seat may be checked in on. A day nobody bought is shown
        // disabled with a reason rather than hidden — a person missing from
        // search reads as a broken system to whoever is on the door.
        valid_days: reg.days,
      })),
  })).filter((r) => confirmed.has(r.registration_id));

  return adminJson({ today, registrations: payload }, 200, origin);
}

async function loadEvents(
  sb: SupabaseClient,
  attendeeIds: string[],
  origin: string,
): Promise<AttendeeEvent[] | Response> {
  if (attendeeIds.length === 0) return [];
  const { data, error } = await sb
    .from('check_in_events')
    .select('id, attendee_id, day, kind, voids_event_id, occurred_at')
    .in('attendee_id', attendeeIds);
  if (error) return adminJson({ error: 'query_failed' }, 500, origin);
  return (data ?? []) as AttendeeEvent[];
}

/**
 * The whole confirmed roster for the current edition, for the paper fallback.
 *
 * This is what the door runs on when the network, the tablet, or the Worker is
 * unavailable, so it has to stand alone on paper. Phones stay masked to the last
 * four digits: enough to verify against what someone tells you at the door, and
 * a far smaller liability than a printed sheet of 273 full numbers if it is left
 * on a table.
 */
export async function handleCheckInRoster(
  _req: Request,
  env: Env,
  sb: SupabaseClient,
  origin: string,
): Promise<Response> {
  const edition = await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_current_edition' }, 503, origin);

  const regs = await sb
    .from('registrations')
    .select('id, user_phone, pass_type, days')
    .eq('edition_id', edition.id)
    .eq('payment_status', 'confirmed');
  if (regs.error) return adminJson({ error: 'query_failed' }, 500, origin);
  const registrations = (regs.data ?? []) as RegistrationRow[];
  const byId = new Map(registrations.map((r) => [r.id, r]));

  const attendees = await sb
    .from('attendees')
    .select('id, seat_index, display_name, phone, is_purchaser, registration_id')
    .eq('edition_id', edition.id)
    .order('seat_index', { ascending: true });
  if (attendees.error) return adminJson({ error: 'query_failed' }, 500, origin);
  const rows = ((attendees.data ?? []) as AttendeeRow[]).filter((a) => byId.has(a.registration_id));

  const events = await loadEvents(sb, rows.map((a) => a.id), origin);
  if (events instanceof Response) return events;

  const roster = rows.map((a) => {
    const reg = byId.get(a.registration_id)!;
    return {
      attendee_id: a.id,
      name: seatLabel(a.display_name, a.seat_index),
      seat_index: a.seat_index,
      is_purchaser: a.is_purchaser,
      // A guest seat has no number of its own yet, so fall back to the
      // purchaser's — otherwise the paper row has nothing to check against.
      phone_masked: maskPhone(a.phone ?? reg.user_phone),
      pass_type: reg.pass_type,
      days: reg.days,
      state: currentState(eventsFor(events, a.id)),
    };
  }).sort((x, y) => x.name.localeCompare(y.name));

  return adminJson({ edition: edition.slug, generated_at: new Date().toISOString(), roster }, 200, origin);
}

interface CheckInRequest {
  attendee_id: string;
  day: EventDay;
  kind: EventKind;
  client_event_id: string;
  display_name?: string | null;
  phone?: string | null;
  note?: string | null;
}

function parseCheckIn(input: any): CheckInRequest {
  if (!UUID.test(String(input?.attendee_id ?? ''))) throw new Error('invalid_attendee_id');
  if (!UUID.test(String(input?.client_event_id ?? ''))) throw new Error('invalid_client_event_id');
  if (!DAYS.includes(input?.day)) throw new Error('invalid_day');
  if (!KINDS.includes(input?.kind)) throw new Error('invalid_kind');

  const name = typeof input.display_name === 'string' ? input.display_name.trim() : null;
  if (name && name.length > 80) throw new Error('invalid_display_name');

  const phone = input.phone === undefined || input.phone === null || input.phone === ''
    ? null
    : normalizePhone(input.phone);
  if (phone !== null && phone.length !== 10) throw new Error('invalid_phone');

  return {
    attendee_id: input.attendee_id,
    day: input.day,
    kind: input.kind,
    client_event_id: input.client_event_id,
    display_name: name || null,
    phone,
    note: typeof input.note === 'string' ? input.note.trim().slice(0, 200) || null : null,
  };
}

/**
 * Records one check-in or exit, and captures the attendee's identity in the same
 * operation when the desk collected it.
 *
 * Identity capture is prompted, never enforced. A blocked check-in is worse than
 * a nameless one: someone will refuse, or be a child, or be holding two bags.
 * A phone already used by another attendee returns a warning alongside success —
 * couples and families share numbers, and pairing does not depend on the phone
 * being unique because the code is the whole credential.
 */
export async function recordCheckIn(
  sb: SupabaseClient,
  input: CheckInRequest,
  actorEmail: string,
): Promise<{ ok: true; event_id: string; deduped: boolean; warning?: string } | { ok: false; error: string; status: number }> {
  const attendee = await sb
    .from('attendees')
    .select('id, edition_id, seat_index, display_name, phone, registration_id')
    .eq('id', input.attendee_id)
    .maybeSingle();
  if (attendee.error) return { ok: false, error: 'query_failed', status: 500 };
  if (!attendee.data) return { ok: false, error: 'attendee_not_found', status: 404 };
  const row = attendee.data as AttendeeRow & { edition_id: string };

  let warning: string | undefined;

  if (input.display_name || input.phone) {
    const patch: Record<string, unknown> = {};
    if (input.display_name) patch.display_name = input.display_name;
    if (input.phone) patch.phone = input.phone;

    if (input.phone) {
      const clash = await sb
        .from('attendees')
        .select('id, seat_index, display_name')
        .eq('edition_id', row.edition_id)
        .eq('phone', input.phone)
        .neq('id', row.id)
        .limit(1);
      if (!clash.error && (clash.data ?? []).length > 0) {
        const other = clash.data![0] as AttendeeRow;
        warning = `phone_already_used_by:${seatLabel(other.display_name, other.seat_index)}`;
      }
    }

    const updated = await sb.from('attendees').update(patch).eq('id', row.id);
    if (updated.error) return { ok: false, error: 'attendee_update_failed', status: 500 };
    await writeAudit(sb, {
      actor_email: actorEmail,
      action: 'attendee.identify',
      target_table: 'attendees',
      target_id: row.id,
      diff: patch,
    });
  }

  const insert = await sb
    .from('check_in_events')
    .insert({
      attendee_id: row.id,
      edition_id: row.edition_id,
      day: input.day,
      kind: input.kind,
      client_event_id: input.client_event_id,
      actor_email: actorEmail,
      note: input.note,
    })
    .select('id')
    .single();

  if (insert.error) {
    // The kiosk generates client_event_id before queueing, so a replay after a
    // network drop lands here. Returning the existing event is what makes the
    // offline queue safe: no duplicate, and no error the operator must judge.
    if (insert.error.code === '23505') {
      const existing = await sb
        .from('check_in_events')
        .select('id')
        .eq('client_event_id', input.client_event_id)
        .maybeSingle();
      if (existing.data) {
        return { ok: true, event_id: (existing.data as { id: string }).id, deduped: true, warning };
      }
    }
    if (insert.error.message?.includes('day_not_purchased')) {
      return { ok: false, error: 'day_not_purchased', status: 409 };
    }
    return { ok: false, error: 'check_in_failed', status: 500 };
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: `check_in.${input.kind}`,
    target_table: 'check_in_events',
    target_id: (insert.data as { id: string }).id,
    diff: { attendee_id: row.id, day: input.day, kind: input.kind },
  });

  return { ok: true, event_id: (insert.data as { id: string }).id, deduped: false, warning };
}

export async function handleCheckIn(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let input: CheckInRequest;
  try {
    input = parseCheckIn(await req.json());
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const result = await recordCheckIn(sb, input, actorEmail);
  if (!result.ok) return adminJson({ error: result.error }, result.status, origin);
  return adminJson(
    { event_id: result.event_id, deduped: result.deduped, warning: result.warning ?? null },
    200,
    origin,
  );
}

/**
 * "Check in all", and the couple arriving together.
 *
 * Reports per attendee rather than failing the batch: if one seat's day is not
 * covered by their ticket, the rest of the group must still get through.
 */
export async function handleCheckInBulk(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let entries: CheckInRequest[];
  try {
    const body = await req.json<{ entries?: unknown[] }>();
    if (!Array.isArray(body?.entries) || body.entries.length === 0) throw new Error('invalid_entries');
    if (body.entries.length > 20) throw new Error('too_many_entries');
    entries = body.entries.map(parseCheckIn);
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const results = [];
  for (const entry of entries) {
    const result = await recordCheckIn(sb, entry, actorEmail);
    results.push(
      result.ok
        ? { attendee_id: entry.attendee_id, ok: true, event_id: result.event_id, deduped: result.deduped, warning: result.warning ?? null }
        : { attendee_id: entry.attendee_id, ok: false, error: result.error },
    );
  }
  return adminJson({ results }, 200, origin);
}

/**
 * Undo appends a voiding row rather than deleting anything — the table grants no
 * delete at all. Both the void and its target drop out of the fold.
 */
export async function handleCheckInUndo(
  req: Request,
  sb: SupabaseClient,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  let eventId: string;
  let clientEventId: string;
  try {
    const body = await req.json<{ event_id?: string; client_event_id?: string }>();
    if (!UUID.test(String(body?.event_id ?? ''))) throw new Error('invalid_event_id');
    if (!UUID.test(String(body?.client_event_id ?? ''))) throw new Error('invalid_client_event_id');
    eventId = body.event_id!;
    clientEventId = body.client_event_id!;
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const target = await sb
    .from('check_in_events')
    .select('id, attendee_id, edition_id, day, kind')
    .eq('id', eventId)
    .maybeSingle();
  if (target.error) return adminJson({ error: 'query_failed' }, 500, origin);
  if (!target.data) return adminJson({ error: 'event_not_found' }, 404, origin);
  const row = target.data as { id: string; attendee_id: string; edition_id: string; day: EventDay; kind: EventKind };

  const insert = await sb
    .from('check_in_events')
    .insert({
      attendee_id: row.attendee_id,
      edition_id: row.edition_id,
      day: row.day,
      kind: row.kind,
      voids_event_id: row.id,
      client_event_id: clientEventId,
      actor_email: actorEmail,
    })
    .select('id')
    .single();
  if (insert.error) {
    if (insert.error.code === '23505') return adminJson({ deduped: true }, 200, origin);
    return adminJson({ error: 'undo_failed' }, 500, origin);
  }

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'check_in.undo',
    target_table: 'check_in_events',
    target_id: row.id,
    diff: { voided: row.id, attendee_id: row.attendee_id, day: row.day },
  });

  return adminJson({ event_id: (insert.data as { id: string }).id, deduped: false }, 200, origin);
}

/** Naming or numbering a seat after the fact, when the desk did not capture it. */
export async function handleAttendeePatch(
  req: Request,
  sb: SupabaseClient,
  attendeeId: string,
  actorEmail: string,
  origin: string,
): Promise<Response> {
  if (!UUID.test(attendeeId)) return adminJson({ error: 'invalid_attendee_id' }, 400, origin);

  let patch: Record<string, unknown>;
  try {
    const body = await req.json<{ display_name?: unknown; phone?: unknown }>();
    patch = {};
    if (body.display_name !== undefined) {
      const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
      if (name.length > 80) throw new Error('invalid_display_name');
      patch.display_name = name || null;
    }
    if (body.phone !== undefined) {
      if (body.phone === null || body.phone === '') patch.phone = null;
      else {
        const phone = normalizePhone(body.phone);
        if (phone.length !== 10) throw new Error('invalid_phone');
        patch.phone = phone;
      }
    }
    if (Object.keys(patch).length === 0) throw new Error('nothing_to_update');
  } catch (error) {
    return adminJson({ error: (error as Error).message }, 400, origin);
  }

  const updated = await sb.from('attendees').update(patch).eq('id', attendeeId).select('id').maybeSingle();
  if (updated.error) return adminJson({ error: 'update_failed' }, 500, origin);
  if (!updated.data) return adminJson({ error: 'attendee_not_found' }, 404, origin);

  await writeAudit(sb, {
    actor_email: actorEmail,
    action: 'attendee.update',
    target_table: 'attendees',
    target_id: attendeeId,
    diff: patch,
  });

  return adminJson({ ok: true }, 200, origin);
}

export { hasArrivedOn };
