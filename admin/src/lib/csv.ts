// admin/src/lib/csv.ts
// Client-side CSV export. The admin app already holds the full row set in
// memory (the worker returns unpaginated lists), so building the file in the
// browser avoids a second authenticated round trip through Cloudflare Access.

function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Guard against spreadsheet formula injection from user-supplied names.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return lines.join('\n') + '\n';
}

export function downloadCsv(filename: string, csv: string): void {
  // Excel needs the BOM to read UTF-8 names correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const ROSTER_HEADERS = ['name', 'phone_last4', 'pass', 'days', 'day1', 'day2'] as const;

/**
 * The paper fallback for the door. Phones stay masked: enough to check against
 * what someone tells you, far less to lose than a sheet of full numbers.
 */
export function rosterToCsv(
  roster: readonly {
    name: string;
    phone_masked: string | null;
    pass_type: string;
    days: readonly string[];
    state: Record<string, string | null>;
  }[],
): string {
  return toCsv(
    ROSTER_HEADERS,
    roster.map((r) => [
      r.name,
      r.phone_masked?.replace(/\D/g, '') ?? '',
      r.pass_type,
      r.days.join(' + '),
      r.days.includes('day1') ? (r.state.day1 ?? 'not arrived') : 'n/a',
      r.days.includes('day2') ? (r.state.day2 ?? 'not arrived') : 'n/a',
    ]),
  );
}

const BOOKINGS_HEADERS = [
  'day', 'time', 'session', 'location', 'host', 'capacity',
  'status', 'position', 'name', 'phone_last4', 'booked_at',
] as const;

interface ExportableSession {
  title: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  location: string | null;
  host_name: string | null;
  capacity: number | null;
  confirmed: readonly { name: string; phone_masked: string | null; signed_up_at: string }[];
  waitlisted: readonly { name: string; phone_masked: string | null; signed_up_at: string }[];
}

/**
 * The paper fallback for the programme, in the same spirit as the door roster.
 *
 * One row per person rather than one per session, so it sorts and filters in a
 * spreadsheet — and so a host can be handed the two lines that are theirs.
 * Sessions with nobody in them still get a row, because "nobody booked" is the
 * thing somebody standing at an empty table needs to see confirmed.
 *
 * Phones stay masked. This sheet is carried around a venue; it is checked
 * against what somebody standing there tells you, which the last four digits
 * do. Ringing a no-show is the library ledger's job, not this one.
 */
export function bookingsToCsv(sessions: readonly ExportableSession[]): string {
  const rows: unknown[][] = [];
  for (const session of sessions) {
    const time = session.is_all_day
      ? 'All day'
      : [session.start_time?.slice(0, 5), session.end_time?.slice(0, 5)].filter(Boolean).join('–');
    const shared = [session.day, time, session.title, session.location ?? '', session.host_name ?? '', session.capacity ?? ''];

    if (session.confirmed.length === 0 && session.waitlisted.length === 0) {
      rows.push([...shared, 'empty', '', '', '', '']);
      continue;
    }
    for (const person of session.confirmed) {
      rows.push([...shared, 'confirmed', '', person.name, person.phone_masked?.replace(/\D/g, '') ?? '', person.signed_up_at]);
    }
    session.waitlisted.forEach((person, index) => {
      rows.push([...shared, 'waitlisted', index + 1, person.name, person.phone_masked?.replace(/\D/g, '') ?? '', person.signed_up_at]);
    });
  }
  return toCsv(BOOKINGS_HEADERS, rows);
}

const LEDGER_HEADERS = [
  'game', 'copy', 'borrower', 'contact', 'contact_is_purchaser',
  'checked_out_at', 'due_at', 'overdue', 'returned_at', 'taken_by',
] as const;

export interface LedgerLoan {
  title: string;
  copy_number: number;
  attendee_name: string;
  contact_phone: string | null;
  contact_is_purchaser: boolean;
  checked_out_at: string;
  due_at: string;
  overdue: boolean;
}

export interface LedgerWithdrawn {
  title: string | null;
  copy_number: number;
  note: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
}

/**
 * The reconciliation export: what is out, plus what is off the shelf.
 *
 * Unlike the door roster this carries full numbers. The two artefacts have
 * different jobs — the roster is checked against what somebody standing there
 * tells you, this one is used to ring people who have walked off with a game,
 * and a masked number cannot do that. It is downloaded by an authenticated
 * admin and holds no more than the screen they are already looking at.
 *
 * The last two columns are deliberately blank: this is the sheet that gets
 * filled in by hand when the network is down.
 */
export function ledgerToCsv(loans: readonly LedgerLoan[], withdrawn: readonly LedgerWithdrawn[]): string {
  const rows: unknown[][] = loans.map((loan) => [
    loan.title,
    loan.copy_number,
    loan.attendee_name,
    loan.contact_phone ?? '',
    loan.contact_is_purchaser ? 'purchaser' : '',
    loan.checked_out_at,
    loan.due_at,
    loan.overdue ? 'OVERDUE' : '',
    '',
    '',
  ]);

  if (withdrawn.length > 0) {
    rows.push([]);
    rows.push(['OFF THE SHELF', '', '', '', '', '', '', '', '', '']);
    for (const copy of withdrawn) {
      rows.push([
        copy.title ?? '', copy.copy_number, '', '', '',
        copy.withdrawn_at ?? '', '', copy.note ?? '', '', copy.withdrawn_by ?? '',
      ]);
    }
  }

  return toCsv(LEDGER_HEADERS, rows);
}
