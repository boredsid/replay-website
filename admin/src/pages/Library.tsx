import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import QrScanner from '@/components/QrScanner';
import { AlertTriangle, BookOpen, Clock, Search } from 'lucide-react';
import type { LibraryLoan, LibraryScan, LibraryTitle } from '@/lib/types';

/**
 * The game-library desk.
 *
 * One screen, two halves: scan somebody, or look at what is out. The scan half
 * never asks staff to choose between lending and returning — the reply says
 * what that person has, and the only button offered is the one that follows
 * from it. Choosing the wrong mode is the mistake a queue reliably produces.
 */
export default function Library() {
  const [scan, setScan] = useState<LibraryScan | null>(null);
  // Kept because the scan response deliberately does not echo the token back,
  // and refreshing after an action means looking the same person up again.
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loansQuery, setLoansQuery] = useState('');
  const [titleQuery, setTitleQuery] = useState('');
  const [titles, setTitles] = useState<LibraryTitle[]>([]);
  const [searchingTitles, setSearchingTitles] = useState(false);

  const loadLoans = useCallback(async (query = '') => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
      const data = await fetchAdmin<{ loans: LibraryLoan[]; overdue_count: number }>(
        `/api/admin/library/loans${params}`,
      );
      setLoans(data.loans);
      setOverdueCount(data.overdue_count);
    } catch (error) { showApiError(error); }
  }, []);

  useEffect(() => { void loadLoans(); }, [loadLoans]);

  // What is out changes because of other people at the same counter, so the
  // list refreshes on its own rather than waiting for someone to reload.
  useEffect(() => {
    const timer = window.setInterval(() => { void loadLoans(loansQuery); }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadLoans, loansQuery]);

  const lookUp = useCallback(async (token: string) => {
    setBusy(true);
    try {
      const data = await fetchAdmin<LibraryScan>('/api/admin/scan', {
        method: 'POST',
        body: JSON.stringify({ qr_token: token }),
      });
      setScan(data);
      setLastToken(token);
      setTitles([]);
      setTitleQuery('');
    } catch (error) {
      setScan(null);
      showApiError(error);
    } finally { setBusy(false); }
  }, []);

  const act = useCallback(async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await fetchAdmin(path, { method: 'POST', body: JSON.stringify(body) });
      toast.success(done);
      // Re-read rather than patching local state: another member of staff may
      // have touched the same copy between the scan and the tap.
      if (lastToken) await lookUp(lastToken);
      await loadLoans(loansQuery);
    } catch (error) { showApiError(error); } finally { setBusy(false); }
  }, [lastToken, lookUp, loadLoans, loansQuery]);

  const searchTitles = useCallback(async (query: string) => {
    setTitleQuery(query);
    if (query.trim().length < 2) { setTitles([]); return; }
    setSearchingTitles(true);
    try {
      const data = await fetchAdmin<{ titles: LibraryTitle[] }>(
        `/api/admin/library/titles?q=${encodeURIComponent(query.trim())}`,
      );
      setTitles(data.titles);
    } catch (error) { showApiError(error); } finally { setSearchingTitles(false); }
  }, []);

  const checkOut = (copyId: string) => {
    if (!scan) return;
    void act('/api/admin/library/checkout', { attendee_id: scan.attendee_id, copy_id: copyId }, 'Checked out');
  };

  const returnLoan = (loanId: string, damaged: boolean) => {
    let note: string | null = null;
    if (damaged) {
      note = window.prompt('What is wrong with it? The copy comes off the shelf until someone fixes it.');
      if (note === null || note.trim().length === 0) return;
    }
    void act('/api/admin/library/return', { loan_id: loanId, withdraw_note: note }, damaged ? 'Returned and withdrawn' : 'Returned');
  };

  const markLost = (loanId: string) => {
    const note = window.prompt('Marking this copy lost takes it out of circulation. Note (optional):') ?? null;
    void act('/api/admin/library/lost', { loan_id: loanId, note }, 'Marked lost');
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Game library</h1>
          <p className="text-sm text-muted-foreground">
            Scan a pass to lend or take back. {loans.length} out
            {overdueCount > 0 && <span className="font-semibold text-destructive"> · {overdueCount} overdue</span>}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4" aria-label="Scan a pass">
          <QrScanner onScan={(token) => void lookUp(token)} busy={busy} />

          {scan && (
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <p className="font-heading text-lg font-semibold">{scan.name}</p>
                <p className="text-sm text-muted-foreground">
                  {scan.pass_type === 'campaign' ? 'Both days' : 'One day'}
                  {!scan.arrived_today && (
                    <span className="ml-2 font-semibold text-destructive">Not checked in</span>
                  )}
                </p>
              </div>

              {scan.library.loan ? (
                <div className="space-y-3 rounded-md bg-muted p-3">
                  <p className="text-sm">
                    Has <strong>{scan.library.loan.title}</strong>
                    {scan.library.loan.copy_number !== null && ` (copy ${scan.library.loan.copy_number})`}
                    {scan.library.loan.overdue && (
                      <span className="ml-2 font-semibold text-destructive">Overdue</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => returnLoan(scan.library.loan!.loan_id, false)}>
                      Take it back
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => returnLoan(scan.library.loan!.loan_id, true)}>
                      Back, but damaged
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => markLost(scan.library.loan!.loan_id)}>
                      Mark lost
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {scan.library.hold && (
                    <div className="space-y-3 rounded-md bg-muted p-3">
                      <p className="text-sm">
                        Requested <strong>{scan.library.hold.title}</strong>
                        {scan.library.hold.copy_number !== null && ` (copy ${scan.library.hold.copy_number})`}
                        {/* A lapsed hold is shown, not hidden: if the box is still
                            on the shelf they get it anyway, and staff should not
                            have to hear "but I requested it" with an empty screen. */}
                        {scan.library.hold.expired && (
                          <span className="ml-2 text-muted-foreground">· hold lapsed, copy still free</span>
                        )}
                      </p>
                      <Button disabled={busy} onClick={() => checkOut(scan.library.hold!.copy_id)}>
                        Hand it over
                      </Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="title-search" className="text-sm font-medium">
                      {scan.library.hold ? 'Or lend something else' : 'Lend a game'}
                    </label>
                    <Input
                      id="title-search"
                      value={titleQuery}
                      onChange={(event) => void searchTitles(event.target.value)}
                      placeholder="Search the shelf…"
                      autoComplete="off"
                    />
                    {searchingTitles && <p className="text-sm text-muted-foreground">Searching…</p>}
                    {titles.map((title) => (
                      <div key={title.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                        <span className="text-sm">{title.title}</span>
                        {title.free_copies.length > 0 ? (
                          <Button size="sm" disabled={busy} onClick={() => checkOut(title.free_copies[0].id)}>
                            Lend copy {title.free_copies[0].copy_number}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">None free</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3" aria-label="Games currently out">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              value={loansQuery}
              onChange={(event) => { setLoansQuery(event.target.value); void loadLoans(event.target.value); }}
              placeholder="Find by game, person or number…"
              autoComplete="off"
              aria-label="Search what is out"
            />
          </div>

          {loans.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <BookOpen className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
              Nothing is out right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {loans.map((loan) => (
                <li
                  key={loan.loan_id}
                  className={`rounded-lg border p-3 ${loan.overdue ? 'border-destructive/50 bg-destructive/5' : ''}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{loan.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {loan.attendee_name}
                        {loan.contact_phone && (
                          <>
                            {' · '}
                            <a className="underline" href={`tel:${loan.contact_phone}`}>{loan.contact_phone}</a>
                            {/* A guest on seat 2 has no phone of their own. Staff
                                need to know whose number they are ringing. */}
                            {loan.contact_is_purchaser && <span className="ml-1">(purchaser)</span>}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 text-xs ${loan.overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                        {loan.overdue
                          ? <><AlertTriangle className="h-3 w-3" aria-hidden="true" />{Math.abs(loan.minutes_remaining)} min over</>
                          : <><Clock className="h-3 w-3" aria-hidden="true" />{loan.minutes_remaining} min left</>}
                      </span>
                      {/* The fallback path: a copy found and returned without the
                          attendee or their phone being present at all. */}
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => returnLoan(loan.loan_id, false)}>
                        Returned
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
