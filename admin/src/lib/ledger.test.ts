import { describe, expect, it } from 'vitest';
import { ledgerHtml } from './ledger';
import { ledgerToCsv, type LedgerLoan, type LedgerWithdrawn } from './csv';

const LOAN: LedgerLoan = {
  title: 'Catan',
  copy_number: 2,
  attendee_name: 'Siddhant Narula',
  contact_phone: '9982200768',
  contact_is_purchaser: false,
  checked_out_at: '2026-09-12T08:30:00Z',
  due_at: '2026-09-12T12:30:00Z',
  overdue: false,
};

const WITHDRAWN: LedgerWithdrawn = {
  title: 'Wingspan',
  copy_number: 1,
  note: 'two meeples missing',
  withdrawn_by: 'staff@replaycon.in',
  withdrawn_at: '2026-09-12T09:00:00Z',
};

const PRINTED = new Date('2026-09-12T09:15:00Z');

describe('the printed ledger', () => {
  it('carries no phone number at all', () => {
    // This sheet sits face-up on a counter all day, in reach of everyone who
    // walks past. Finding a loan and ticking it off needs no phone number.
    const html = ledgerHtml([LOAN], []);
    expect(html).not.toContain('9982200768');
  });

  it('leaves somewhere to actually write', () => {
    const html = ledgerHtml([LOAN], [], PRINTED);
    expect(html).toContain('Returned at');
    expect(html).toContain('Taken by');
    expect(html).toContain('class="write"');
  });

  it('says who is holding what, and when it is due', () => {
    const html = ledgerHtml([LOAN], [], PRINTED);
    expect(html).toContain('Catan');
    expect(html).toContain('Siddhant Narula');
    // Times are in IST, which is where the event is.
    expect(html).toContain('06:00 pm');
  });

  it('marks what was already overdue when it printed', () => {
    const html = ledgerHtml([{ ...LOAN, overdue: true }], [], PRINTED);
    expect(html).toContain('class="over"');
  });

  it('stamps when it was printed, so two sheets cannot be confused', () => {
    // Matched loosely on purpose: Intl's exact punctuation varies between ICU
    // builds, so pinning the whole string would fail on somebody else's
    // machine for a reason that has nothing to do with the ledger.
    const html = ledgerHtml([LOAN], [], PRINTED);
    expect(html).toMatch(/Printed[^<]*Sat[^<]*12 Sep/);
    expect(html).toMatch(/Printed[^<]*02:45\s*pm/);
  });

  it('lists copies off the shelf for the end-of-weekend count', () => {
    const html = ledgerHtml([LOAN], [WITHDRAWN], PRINTED);
    expect(html).toContain('Off the shelf (1)');
    expect(html).toContain('two meeples missing');
  });

  it('omits that section entirely when nothing is withdrawn', () => {
    expect(ledgerHtml([LOAN], [], PRINTED)).not.toContain('Off the shelf');
  });

  it('says so plainly when nothing is out', () => {
    expect(ledgerHtml([], [], PRINTED)).toContain('Nothing is out.');
  });

  it('escapes a game title that contains markup', () => {
    const html = ledgerHtml([{ ...LOAN, title: '<script>alert(1)</script>' }], [], PRINTED);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the ledger CSV', () => {
  it('does carry the number, because chasing a game needs one', () => {
    // The opposite choice from the printed sheet, deliberately: this is
    // downloaded by an authenticated admin and holds no more than the screen
    // they are already looking at.
    expect(ledgerToCsv([LOAN], [])).toContain('9982200768');
  });

  it('flags a number that belongs to the purchaser, not the borrower', () => {
    expect(ledgerToCsv([{ ...LOAN, contact_is_purchaser: true }], [])).toContain('purchaser');
  });

  it('leaves the hand-written columns empty', () => {
    const [, row] = ledgerToCsv([LOAN], []).trim().split('\n');
    expect(row.endsWith(',,')).toBe(true);
  });

  it('marks the overdue ones', () => {
    expect(ledgerToCsv([{ ...LOAN, overdue: true }], [])).toContain('OVERDUE');
  });

  it('appends what is off the shelf under its own heading', () => {
    const csv = ledgerToCsv([LOAN], [WITHDRAWN]);
    expect(csv).toContain('OFF THE SHELF');
    expect(csv).toContain('two meeples missing');
  });

  it('neutralises a name that would be read as a spreadsheet formula', () => {
    const csv = ledgerToCsv([{ ...LOAN, attendee_name: '=cmd|calc' }], []);
    expect(csv).toContain("'=cmd|calc");
  });
});
