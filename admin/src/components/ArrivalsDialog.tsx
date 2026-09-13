// Who is actually in the building, with numbers that can be rung.
//
// Everything else on the check-in desk masks phone numbers to the last four
// digits, and that is right: a volunteer verifying somebody at the door needs to
// check a number against what they are told, not read one out, and a tablet left
// on a table is a sheet of every attendee's number. This screen is the
// deliberate exception — the organiser chasing a lost bag, a missing child or a
// no-show host needs to ring the person — which is why the Worker keeps the
// endpoint behind `ADMIN_ONLY` and this dialog behind `useIsFullAdmin`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { ArrivalRow, ArrivalsResponse, CheckInDay } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/Loading';
import { arrivalsToCsv, downloadCsv } from '@/lib/csv';
import { formatPhone } from '@/lib/whatsapp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DAY_LABEL: Record<CheckInDay, string> = { day1: 'Sat', day2: 'Sun' };

/** The event runs in IST whoever is holding the tablet. */
const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function clockTime(iso: string | null): string | null {
  return iso ? TIME.format(new Date(iso)) : null;
}

/**
 * Matching is on digits as well as name, because the number is what somebody
 * reading this back from a phone call has to hand. Both numbers on the row are
 * searchable: on a guest seat the buyer's is the only one there is.
 */
export function matchesArrival(row: ArrivalRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, '');
  if (digits.length >= 3) {
    return [row.phone, row.purchaser_phone].some((p) => p?.includes(digits));
  }
  return [row.name, row.purchaser_name].some((n) => n?.toLowerCase().includes(needle));
}

/** One day's line on a row: when they got here, and whether they are still in. */
function DayLine({ row, day }: { row: ArrivalRow; day: CheckInDay }) {
  const arrived = clockTime(row.arrived_at[day]);
  if (!arrived) return null;
  const inside = row.state[day] === 'in';
  const left = !inside ? clockTime(row.last_seen_at[day]) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={`size-2 rounded-full ${inside ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
      />
      <span>
        {DAY_LABEL[day]} {arrived}
        {inside ? ' · inside' : left ? ` · left ${left}` : ' · left'}
      </span>
    </span>
  );
}

export default function ArrivalsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<ArrivalsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState<CheckInDay | 'all'>('all');
  const [filter, setFilter] = useState('');

  const load = useCallback(async (which: CheckInDay | 'all') => {
    setLoading(true);
    try {
      const query = which === 'all' ? '' : `?day=${which}`;
      setData(await fetchAdmin<ArrivalsResponse>(`/api/admin/check-in/arrivals${query}`));
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetched on open rather than kept fresh: this is a list somebody reads for a
  // minute, and a poll would keep a page of full phone numbers on a screen
  // nobody is looking at.
  useEffect(() => { if (open) void load(day); }, [open, day, load]);

  const rows = useMemo(
    () => (data?.arrivals ?? []).filter((row) => matchesArrival(row, filter)),
    [data, filter],
  );

  const inside = useMemo(
    () => (data?.arrivals ?? []).filter(
      (row) => (['day1', 'day2'] as CheckInDay[]).some((d) => row.state[d] === 'in'),
    ).length,
    [data],
  );

  function download() {
    if (!data?.arrivals.length) { toast.error('Nobody has checked in yet.'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = data.day ? `-${DAY_LABEL[data.day].toLowerCase()}` : '';
    downloadCsv(`replay-arrivals${suffix}-${stamp}.csv`, arrivalsToCsv(data.arrivals));
    toast.success(`${data.arrivals.length} arrivals exported`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Who’s checked in</DialogTitle>
          <DialogDescription>
            Everyone who has come through the door, with full phone numbers. Only
            full admins can open this — the desk works from the last four digits.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Filter by day">
            {(['all', 'day1', 'day2'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={day === option ? 'default' : 'outline'}
                onClick={() => setDay(option)}
              >
                {option === 'all' ? 'Both days' : DAY_LABEL[option]}
              </Button>
            ))}
          </div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or number"
            aria-label="Filter arrivals by name or number"
            className="w-full sm:w-56"
          />
          <Button type="button" size="sm" variant="outline" onClick={download}>
            CSV
          </Button>
        </div>

        {loading && <Loading><span>Loading arrivals…</span></Loading>}

        {!loading && data && (
          <p className="text-sm text-muted-foreground" role="status">
            {data.arrivals.length} checked in · {inside} inside right now
            {filter.trim() && ` · showing ${rows.length}`}
          </p>
        )}

        {!loading && data?.arrivals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nobody has been checked in yet{data.day ? ` on ${DAY_LABEL[data.day]}` : ''}.
          </p>
        )}

        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.attendee_id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{row.name}</span>
                <span className="text-xs text-muted-foreground">
                  {row.pass_type} · {row.days.map((d) => DAY_LABEL[d]).join(' + ')}
                  {!row.is_purchaser && ' · guest'}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {/* A tel: link, because this is opened on a phone mid-event. */}
                {row.phone ? (
                  <a className="underline underline-offset-2" href={`tel:+91${row.phone}`}>
                    {formatPhone(row.phone)}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No number of their own</span>
                )}
                {/* Whose number you are about to ring matters as much as the
                    number, so the buyer is always named next to theirs. */}
                {row.purchaser_phone !== row.phone && (
                  <span className="text-muted-foreground">
                    Booked by {row.purchaser_name ?? 'unknown'}{' '}
                    <a className="underline underline-offset-2" href={`tel:+91${row.purchaser_phone}`}>
                      {formatPhone(row.purchaser_phone)}
                    </a>
                  </span>
                )}
                {row.purchaser_email && (
                  <span className="text-muted-foreground">{row.purchaser_email}</span>
                )}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {(['day1', 'day2'] as CheckInDay[]).map((d) => (
                  <DayLine key={d} row={row} day={d} />
                ))}
              </div>
            </li>
          ))}
        </ul>

        {!loading && data && rows.length === 0 && data.arrivals.length > 0 && (
          <p className="text-sm text-muted-foreground">Nobody here matches that.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
