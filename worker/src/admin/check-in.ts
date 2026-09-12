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
//
// For a guest seat those two are required, not prompted: a seat bought by
// somebody else carries no identity of its own, so an anonymous arrival is a
// person in the building nobody can name. The purchaser is exempt because their
// name and number came with the sale.
import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { writeAudit } from './audit';
import { getCurrentEdition } from '../editions';
import { editionDayForToday, pairingGateDay } from './pairing';
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
/** Far beyond this event's scale; PostgREST would otherwise stop at its default. */
const TOTALS_ROW_LIMIT = 10000;

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
 * The registrations a desk query matches, by every route a person can be known.
 *
 * Phone matches the purchaser's number (the primary path) and an attendee's own
 * number. A name matches an attendee's captured name AND the buyer's name on
 * their account — the second is not redundant, because a seat can be anonymous
 * while its buyer is perfectly well known: a second purchase by the same phone
 * creates anonymous seats by design, and a first seat stays anonymous until the
 * desk names it. Searching those by name found nothing at all before, which
 * reads at the door as "this person is not registered".
 */
export async function matchingRegistrationIds(
  sb: SupabaseClient,
  editionId: string,
  raw: string,
): Promise<Set<string> | null> {
  const digits = normalizePhone(raw);
  const ids = new Set<string>();

  const confirmedRegs = () => sb
    .from('registrations')
    .select('id')
    .eq('edition_id', editionId)
    .eq('payment_status', 'confirmed');

  if (digits.length >= 4) {
    const byPurchaser = await confirmedRegs().like('user_phone', `%${digits}%`).limit(SEARCH_LIMIT);
    if (byPurchaser.error) return null;
    for (const row of byPurchaser.data ?? []) ids.add((row as { id: string }).id);
  } else {
    // The buyer's name, from their account. Seats carry a name only once
    // someone has typed one in.
    const byUser = await sb
      .from('users')
      .select('phone')
      .ilike('name', `${raw}%`)
      .limit(SEARCH_LIMIT);
    if (byUser.error) return null;
    const phones = (byUser.data ?? []).map((row) => (row as { phone: string }).phone);
    if (phones.length > 0) {
      const byBuyerName = await confirmedRegs().in('user_phone', phones).limit(SEARCH_LIMIT);
      if (byBuyerName.error) return null;
      for (const row of byBuyerName.data ?? []) ids.add((row as { id: string }).id);
    }
  }

  // An attendee's own details, captured at a previous check-in.
  const attendeeMatch = sb
    .from('attendees')
    .select('registration_id')
    .eq('edition_id', editionId)
    .limit(SEARCH_LIMIT);
  const byAttendee = digits.length >= 4
    ? await attendeeMatch.like('phone', `%${digits}%`)
    : await attendeeMatch.ilike('display_name', `${raw}%`);
  if (byAttendee.error) return null;
  for (const row of byAttendee.data ?? []) {
    ids.add((row as { registration_id: string }).registration_id);
  }

  return ids;
}

/**
 * Search the desk runs on arrival.
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

  const registrationIds = await matchingRegistrationIds(sb, edition.id, raw);
  if (registrationIds === null) return adminJson({ error: 'query_failed' }, 500, origin);

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
  const editionDates = edition as unknown as { start_date: string; end_date: string };
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
        can_pair: pairingGateDay(editionDates, reg.days, eventsFor(events, a.id)) !== null,
        // Days this seat may be checked in on. A day nobody bought is shown
        // disabled with a reason rather than hidden — a person missing from
        // search reads as a broken system to whoever is on the door.
        valid_days: reg.days,
      })),
  })).filter((r) => confirmed.has(r.registration_id));

  return adminJson({ registrations: payload }, 200, origin);
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

export interface DayTotals {
  /** Seats sold for this day: one per confirmed attendee row that covers it. */
  expected: number;
  /** Seats that have arrived at some point today, lunch breaks included. */
  arrived: number;
  /** Seats inside right now — arrived, and not checked out again since. */
  inside: number;
}

/**
 * How the door is doing, per day.
 *
 * Three numbers rather than two, because they answer different questions and
 * merging them would make one of them wrong. `arrived` is the one the desk means
 * by "checked in so far": someone who stepped out for lunch has still arrived
 * and must keep counting. `inside` is what a fire marshal or a room count
 * wants. They are equal until the first person checks out.
 *
 * Derived from the same event fold the desk buttons use, so a total can never
 * disagree with the row it was counted from — there is no column to drift, and
 * an undo at the desk removes its seat from both counts.
 */
export function attendanceTotals(
  seats: ReadonlyArray<{ attendee_id: string; days: readonly EventDay[] }>,
  events: ReadonlyArray<AttendeeEvent>,
): Record<EventDay, DayTotals> {
  const totals: Record<EventDay, DayTotals> = {
    day1: { expected: 0, arrived: 0, inside: 0 },
    day2: { expected: 0, arrived: 0, inside: 0 },
  };
  for (const seat of seats) {
    const own = eventsFor(events, seat.attendee_id);
    const state = currentState(own);
    for (const day of DAYS) {
      if (!seat.days.includes(day)) continue;
      totals[day].expected += 1;
      if (hasArrivedOn(own, day)) totals[day].arrived += 1;
      if (state[day] === 'in') totals[day].inside += 1;
    }
  }
  return totals;
}

/**
 * The day's headline: tickets sold against people through the door.
 *
 * Its own endpoint rather than a field on the search results, because it is a
 * property of the event and not of whoever the desk just looked up — it has to
 * be there before the first search of the morning, and stay right after one.
 */
export async function handleCheckInTotals(
  _req: Request,
  env: Env,
  sb: SupabaseClient,
  origin: string,
  now = new Date(),
): Promise<Response> {
  const edition = await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_current_edition' }, 503, origin);

  const [regs, attendees, events] = await Promise.all([
    sb.from('registrations')
      .select('id, days')
      .eq('edition_id', edition.id)
      .eq('payment_status', 'confirmed')
      .limit(TOTALS_ROW_LIMIT),
    sb.from('attendees')
      .select('id, registration_id')
      .eq('edition_id', edition.id)
      .limit(TOTALS_ROW_LIMIT),
    sb.from('check_in_events')
      .select('id, attendee_id, day, kind, voids_event_id, occurred_at')
      .eq('edition_id', edition.id)
      .limit(TOTALS_ROW_LIMIT),
  ]);
  if (regs.error || attendees.error || events.error) {
    return adminJson({ error: 'query_failed' }, 500, origin);
  }

  // Seats belonging to a cancelled or unpaid registration are not expected at
  // the door, and the database keeps their rows — so the join is the filter.
  const daysByReg = new Map(
    ((regs.data ?? []) as Pick<RegistrationRow, 'id' | 'days'>[]).map((r) => [r.id, r.days]),
  );
  const seats = ((attendees.data ?? []) as Array<{ id: string; registration_id: string }>)
    .filter((a) => daysByReg.has(a.registration_id))
    .map((a) => ({ attendee_id: a.id, days: daysByReg.get(a.registration_id)! }));

  const editionDates = edition as unknown as { start_date: string; end_date: string };
  return adminJson(
    {
      edition: edition.slug,
      // Null outside the event, which is the honest answer in the week before
      // it: the desk is testing, and nothing should be highlighted as live.
      today: editionDayForToday(editionDates, now),
      days: attendanceTotals(seats, (events.data ?? []) as AttendeeEvent[]),
    },
    200,
    origin,
  );
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
 * Whether this arrival may be recorded, given what the seat knows about its
 * occupant and what the desk just typed.
 *
 * A guest seat needs both a name and a number before it can be checked in — it
 * is the only moment anyone stands in front of the person, and a seat that gets
 * through anonymously stays anonymous for the rest of the event. Already-stored
 * details count, so a returning guest is not asked twice.
 *
 * Three things are deliberately outside the gate. The purchaser's seat, whose
 * identity came with the sale. Checking *out*, because refusing to record
 * somebody leaving does not produce a name, it produces a wrong occupancy
 * count. And undo, which appends its own row without coming through here.
 */
export function identityGap(
  seat: Pick<AttendeeRow, 'display_name' | 'phone' | 'is_purchaser'>,
  input: Pick<CheckInRequest, 'kind' | 'display_name' | 'phone'>,
): 'name_and_phone' | 'name' | 'phone' | null {
  if (input.kind !== 'in' || seat.is_purchaser) return null;
  const hasName = Boolean(input.display_name || seat.display_name?.trim());
  const hasPhone = Boolean(input.phone || seat.phone);
  if (!hasName && !hasPhone) return 'name_and_phone';
  if (!hasName) return 'name';
  if (!hasPhone) return 'phone';
  return null;
}

/**
 * Records one check-in or exit, and captures the attendee's identity in the same
 * operation when the desk collected it.
 *
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
    .select('id, edition_id, seat_index, display_name, phone, is_purchaser, registration_id')
    .eq('id', input.attendee_id)
    .maybeSingle();
  if (attendee.error) return { ok: false, error: 'query_failed', status: 500 };
  if (!attendee.data) return { ok: false, error: 'attendee_not_found', status: 404 };
  const row = attendee.data as AttendeeRow & { edition_id: string };

  // Refused before anything is written, so a rejected arrival leaves no half
  // identity on the seat and nothing for the offline queue to replay.
  const gap = identityGap(row, input);
  if (gap) return { ok: false, error: `guest_identity_required:${gap}`, status: 400 };

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
