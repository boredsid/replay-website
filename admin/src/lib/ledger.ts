import type { LedgerLoan, LedgerWithdrawn } from './csv';

/**
 * The paper fallback for the library counter.
 *
 * Opened in its own window and printed, because when the venue network goes
 * down a spreadsheet on somebody's laptop is not what takes a return — a sheet
 * on the counter with a pen next to it is.
 *
 * **No phone numbers.** This sheet sits face-up on a desk all day, in reach of
 * everyone who walks past. What it needs is enough to find a loan and tick it
 * off: who, what, when it was due. Chasing somebody who never came back is a
 * different job, done from the CSV, by an admin, off a screen.
 */
export function ledgerHtml(
  loans: readonly LedgerLoan[],
  withdrawn: readonly LedgerWithdrawn[],
  printedAt: Date = new Date(),
): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(printedAt);

  const time = (iso: string) => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(parsed);
  };

  const escape = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const rows = loans.map((loan) => `
    <tr class="${loan.overdue ? 'over' : ''}">
      <td>${escape(loan.title)}</td>
      <td class="num">${escape(loan.copy_number)}</td>
      <td>${escape(loan.attendee_name)}</td>
      <td class="num">${time(loan.checked_out_at)}</td>
      <td class="num">${time(loan.due_at)}${loan.overdue ? ' <strong>!</strong>' : ''}</td>
      <td class="write"></td>
      <td class="write"></td>
    </tr>`).join('');

  const shelf = withdrawn.length === 0 ? '' : `
    <h2>Off the shelf (${withdrawn.length})</h2>
    <table>
      <thead><tr><th>Game</th><th>Copy</th><th>Why</th><th>Taken off by</th></tr></thead>
      <tbody>${withdrawn.map((copy) => `
        <tr>
          <td>${escape(copy.title)}</td>
          <td class="num">${escape(copy.copy_number)}</td>
          <td>${escape(copy.note)}</td>
          <td>${escape(copy.withdrawn_by)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>REPLAY game library — ledger ${escape(when)}</title>
<style>
  @page { margin: 12mm; }
  body { margin: 0; color: #111; font: 12px/1.4 system-ui, sans-serif; }
  h1 { margin: 0 0 2px; font-size: 18px; }
  h2 { margin: 24px 0 6px; font-size: 14px; }
  .meta { margin: 0 0 14px; color: #555; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #bbb; text-align: left; }
  th { border-bottom: 2px solid #111; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
  .num { white-space: nowrap; }
  /* Wide enough to actually write a time and a name in. */
  .write { width: 96px; border-bottom: 1px solid #bbb; background: #fafafa; }
  .over td { font-weight: 700; }
  .over .num { color: #b00; }
  tfoot td { padding-top: 10px; border: 0; color: #555; font-size: 11px; }
  @media print { .noprint { display: none; } }
</style>
</head>
<body>
  <h1>Game library — what is out</h1>
  <p class="meta">
    Printed ${escape(when)} · ${loans.length} out${withdrawn.length ? ` · ${withdrawn.length} off the shelf` : ''}
    · Deliberately carries no phone numbers.
  </p>
  <p class="noprint"><button onclick="window.print()">Print</button></p>
  <table>
    <thead>
      <tr>
        <th>Game</th><th>Copy</th><th>Borrower</th>
        <th>Out at</th><th>Due</th><th>Returned at</th><th>Taken by</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7">Nothing is out.</td></tr>'}</tbody>
    <tfoot>
      <tr><td colspan="7">
        Record returns here while the network is down, then enter them in the
        admin app afterwards. Rows in bold were already overdue when printed.
      </td></tr>
    </tfoot>
  </table>
  ${shelf}
</body>
</html>`;
}

/** Opens the ledger in its own window, ready to print. */
export function openLedger(html: string): boolean {
  const window_ = window.open('', '_blank');
  if (!window_) return false;
  window_.document.write(html);
  window_.document.close();
  return true;
}
