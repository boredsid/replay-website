import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./audit', () => ({ writeAudit: vi.fn() }));
vi.mock('../editions', () => ({ getCurrentEdition: vi.fn() }));
vi.mock('../attendee-gate', () => ({ attendeeGateDay: vi.fn() }));

import {
  loansForAttendee,
  handleLibraryCheckout,
  handleLibraryReturn,
  handleLibraryWithdraw,
  handleLibraryLost,
  handleLibraryLoans,
  handleLibraryTitleSearch,
} from './library';
import { writeAudit } from './audit';
import { getCurrentEdition } from '../editions';
import { attendeeGateDay } from '../attendee-gate';

const ATTENDEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COPY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LOAN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ORIGIN = 'https://admin.replaycon.in';
const ACTOR = 'staff@replaycon.in';
const MINUTE = 60_000;

const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;
const edition = getCurrentEdition as unknown as ReturnType<typeof vi.fn>;
const gate = attendeeGateDay as unknown as ReturnType<typeof vi.fn>;
const env = {} as never;

function post(body: unknown) {
  return new Request('https://api/api/admin/library/x', { method: 'POST', body: JSON.stringify(body) });
}

function rpcClient(result: { data?: unknown; error?: { message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }) } as never;
}

beforeEach(() => {
  audit.mockReset(); edition.mockReset(); gate.mockReset();
  edition.mockResolvedValue({ id: 'ed-1', start_date: '2026-09-12', end_date: '2026-09-13' });
  gate.mockResolvedValue('day1');
});

describe('what the scan shows the desk', () => {
  function loanClient(rows: unknown[]) {
    return {
      from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: rows, error: null }) }) }) }),
    } as never;
  }
  const row = (o: Record<string, unknown> = {}) => ({
    id: LOAN, status: 'requested', copy_id: COPY,
    request_expires_at: new Date(Date.now() + 2 * MINUTE).toISOString(),
    due_at: null,
    library_copies: { copy_number: 1, library_titles: { key: 'bgg-1', title: 'Catan' } },
    ...o,
  });

  it('shows a live hold with the copy to hand over', async () => {
    const state = await loansForAttendee(loanClient([row()]), ATTENDEE);
    expect(state.hold).toMatchObject({ title: 'Catan', copy_id: COPY, expired: false });
  });

  it('still shows a lapsed hold, flagged as lapsed', async () => {
    // If the box is on the shelf they get it anyway, and staff should not have
    // to hear "but I requested it" with an empty screen in front of them.
    const state = await loansForAttendee(
      loanClient([row({ request_expires_at: new Date(Date.now() - MINUTE).toISOString() })]),
      ATTENDEE,
    );
    expect(state.hold).toMatchObject({ expired: true, title: 'Catan' });
  });

  it('shows an open loan and whether it is late', async () => {
    const state = await loansForAttendee(
      loanClient([row({ status: 'checked_out', due_at: new Date(Date.now() - MINUTE).toISOString() })]),
      ATTENDEE,
    );
    expect(state.loan).toMatchObject({ overdue: true });
    expect(state.hold).toBeNull();
  });

  it('shows nothing for somebody who has neither', async () => {
    expect(await loansForAttendee(loanClient([]), ATTENDEE)).toEqual({ hold: null, loan: null });
  });
});

describe('checking out', () => {
  it('hands over the copy and records who did it', async () => {
    const sb = rpcClient({ data: [{ loan_id: LOAN, due_at: '2026-09-12T18:00:00Z' }] });
    const response = await handleLibraryCheckout(
      post({ attendee_id: ATTENDEE, copy_id: COPY }), env, sb, ACTOR, ORIGIN,
    );
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({
      action: 'library.checkout', actor_email: ACTOR,
    }));
  });

  it('reports a copy somebody else holds as a conflict, not a failure', async () => {
    const sb = rpcClient({ error: { message: 'copy_taken' } });
    const response = await handleLibraryCheckout(post({ attendee_id: ATTENDEE, copy_id: COPY }), env, sb, ACTOR, ORIGIN);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'copy_taken' });
  });

  it('reports a second game as already_borrowing', async () => {
    const sb = rpcClient({ error: { message: 'already_borrowing' } });
    expect((await handleLibraryCheckout(post({ attendee_id: ATTENDEE, copy_id: COPY }), env, sb, ACTOR, ORIGIN)).status).toBe(409);
  });

  it('refuses ids that are not ids before calling the database', async () => {
    const sb = rpcClient({});
    const response = await handleLibraryCheckout(post({ attendee_id: 'nope', copy_id: COPY }), env, sb, ACTOR, ORIGIN);
    expect(response.status).toBe(400);
    expect((sb as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it('refuses to lend to somebody who has not checked in', async () => {
    // The desk screen warns about this, and a warning staff can click past is
    // not a rule. Same gate as the app, from the same function.
    gate.mockResolvedValue(null);
    const sb = rpcClient({});
    const response = await handleLibraryCheckout(
      post({ attendee_id: ATTENDEE, copy_id: COPY }), env, sb, ACTOR, ORIGIN,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'not_checked_in' });
    // And it never reaches the database.
    expect((sb as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it('does not write an audit row when the checkout failed', async () => {
    const sb = rpcClient({ error: { message: 'copy_withdrawn' } });
    await handleLibraryCheckout(post({ attendee_id: ATTENDEE, copy_id: COPY }), env, sb, ACTOR, ORIGIN);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('returning', () => {
  it('takes the copy back', async () => {
    const sb = rpcClient({ data: true });
    const response = await handleLibraryReturn(post({ loan_id: LOAN }), sb, ACTOR, ORIGIN);
    expect(await response.json()).toEqual({ ok: true, withdrawn: false });
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({ action: 'library.return' }));
  });

  it('withdraws a damaged copy in the same action', async () => {
    // The counter is the only place anyone opens these boxes, so it is the only
    // place damage is noticed. A second, later step is a step that gets skipped.
    const sb = rpcClient({ data: true });
    const response = await handleLibraryReturn(
      post({ loan_id: LOAN, withdraw_note: 'two meeples missing' }), sb, ACTOR, ORIGIN,
    );
    expect(await response.json()).toEqual({ ok: true, withdrawn: true });
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({ action: 'library.return_damaged' }));
  });

  it('treats a blank note as no note', async () => {
    const sb = rpcClient({ data: true });
    const response = await handleLibraryReturn(post({ loan_id: LOAN, withdraw_note: '   ' }), sb, ACTOR, ORIGIN);
    expect(await response.json()).toEqual({ ok: true, withdrawn: false });
  });

  it('reports a loan that is not open', async () => {
    const sb = rpcClient({ error: { message: 'loan_not_open' } });
    expect((await handleLibraryReturn(post({ loan_id: LOAN }), sb, ACTOR, ORIGIN)).status).toBe(409);
  });
});

describe('withdrawing', () => {
  it('requires a reason', async () => {
    // A withdrawal without one is a copy nobody can put back with confidence.
    const sb = rpcClient({});
    const response = await handleLibraryWithdraw(post({ copy_id: COPY, note: '  ' }), sb, ACTOR, ORIGIN);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'note_required' });
  });

  it('refuses to withdraw a copy that is out', async () => {
    const sb = rpcClient({ error: { message: 'copy_on_loan' } });
    expect((await handleLibraryWithdraw(post({ copy_id: COPY, note: 'torn' }), sb, ACTOR, ORIGIN)).status).toBe(409);
  });
});

describe('giving up on a copy', () => {
  it('marks it lost so the books can be closed', async () => {
    const sb = rpcClient({ data: true });
    const response = await handleLibraryLost(post({ loan_id: LOAN, note: 'never came back' }), sb, ACTOR, ORIGIN);
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({ action: 'library.lost' }));
  });
});

describe('the circulation list', () => {
  const loans = [
    { loan_id: 'l1', attendee_name: 'Siddhant Narula', contact_phone: '9982200768', title: 'Catan', overdue: true },
    { loan_id: 'l2', attendee_name: 'Guest 2', contact_phone: '9000000000', contact_is_purchaser: true, title: 'Wingspan', overdue: false },
  ];
  const sb = () => ({ rpc: vi.fn().mockResolvedValue({ data: loans, error: null }) }) as never;
  const url = (q: string) => new Request(`https://api/api/admin/library/loans${q}`);

  it('returns everything out, with a count of what is late', async () => {
    const body = await (await handleLibraryLoans(url(''), sb(), ORIGIN)).json() as { loans: unknown[]; overdue_count: number };
    expect(body.loans).toHaveLength(2);
    expect(body.overdue_count).toBe(1);
  });

  it('filters to overdue when asked', async () => {
    const body = await (await handleLibraryLoans(url('?overdue=1'), sb(), ORIGIN)).json() as { loans: Array<{ loan_id: string }> };
    expect(body.loans.map((l) => l.loan_id)).toEqual(['l1']);
  });

  it('searches by game, by person, and by number', async () => {
    // This is the fallback path: a copy found and returned without any QR.
    for (const [query, expected] of [['?q=wing', 'l2'], ['?q=siddhant', 'l1'], ['?q=99822', 'l1']] as const) {
      const body = await (await handleLibraryLoans(url(query), sb(), ORIGIN)).json() as { loans: Array<{ loan_id: string }> };
      expect(body.loans.map((l) => l.loan_id)).toEqual([expected]);
    }
  });

  it('carries the purchaser fallback flag through', async () => {
    // A guest on seat 2 has no phone of their own; the number shown is the
    // buyer's, and the desk needs to know that before it rings it.
    const body = await (await handleLibraryLoans(url('?q=wing'), sb(), ORIGIN)).json() as { loans: Array<{ contact_is_purchaser: boolean }> };
    expect(body.loans[0].contact_is_purchaser).toBe(true);
  });
});

describe('finding a title at the counter', () => {
  function searchClient(opts: { titles?: unknown[]; copies?: unknown[]; live?: unknown[] } = {}) {
    return {
      from: (table: string) => {
        if (table === 'library_titles') return {
          select: () => ({ ilike: () => ({ order: () => ({ limit: async () => ({ data: opts.titles ?? [], error: null }) }) }) }),
        };
        if (table === 'library_copies') return {
          select: () => ({ in: () => ({ eq: async () => ({ data: opts.copies ?? [], error: null }) }) }),
        };
        if (table === 'library_loans') return {
          select: () => ({ in: async () => ({ data: opts.live ?? [], error: null }) }),
        };
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  }
  const url = (q: string) => new Request(`https://api/api/admin/library/titles?q=${q}`);

  it('says nothing for a query too short to mean anything', async () => {
    const body = await (await handleLibraryTitleSearch(url('c'), searchClient(), ORIGIN)).json() as { titles: unknown[] };
    expect(body.titles).toEqual([]);
  });

  it('returns only the copies actually free', async () => {
    const body = await (await handleLibraryTitleSearch(url('catan'), searchClient({
      titles: [{ id: 't1', key: 'bgg-1', title: 'Catan' }],
      copies: [
        { id: 'c1', title_id: 't1', copy_number: 1 },
        { id: 'c2', title_id: 't1', copy_number: 2 },
        { id: 'c3', title_id: 't1', copy_number: 3 },
      ],
      live: [
        { copy_id: 'c1', status: 'checked_out', request_expires_at: new Date().toISOString() },
        { copy_id: 'c2', status: 'requested', request_expires_at: new Date(Date.now() + MINUTE).toISOString() },
      ],
    }), ORIGIN)).json() as { titles: Array<{ free_copies: Array<{ id: string }> }> };
    expect(body.titles[0].free_copies.map((c) => c.id)).toEqual(['c3']);
  });

  it('counts a copy whose hold has lapsed as free again', async () => {
    const body = await (await handleLibraryTitleSearch(url('catan'), searchClient({
      titles: [{ id: 't1', key: 'bgg-1', title: 'Catan' }],
      copies: [{ id: 'c1', title_id: 't1', copy_number: 1 }],
      live: [{ copy_id: 'c1', status: 'requested', request_expires_at: new Date(Date.now() - MINUTE).toISOString() }],
    }), ORIGIN)).json() as { titles: Array<{ free_copies: Array<{ id: string }> }> };
    expect(body.titles[0].free_copies.map((c) => c.id)).toEqual(['c1']);
  });
});
