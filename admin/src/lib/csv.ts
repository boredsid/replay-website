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
