import { useEffect, useState } from 'react';
import { fetchAdmin } from '@/lib/api';
import type { DashboardData } from '@/lib/types';
import { Loading } from '@/components/Loading';
import { onRevalidate } from '@/lib/revalidate';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const result = await fetchAdmin<DashboardData>('/api/admin/dashboard');
        if (active && current === request) { setData(result); setError(''); }
      } catch (e) {
        if (active && current === request) { setData(null); setError(e instanceof Error ? e.message : 'Could not load dashboard.'); }
      }
    };
    void load();
    const off = onRevalidate(() => { void load(); });
    return () => { active = false; off(); };
  }, []);
  if (error) return <div role="alert" className="p-6 text-destructive">{error}</div>;
  if (!data) return <Loading><span className="text-muted-foreground text-sm">Loading…</span></Loading>;
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const finances = data.finances;
  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">{data.edition.name} · {data.edition.registration_status}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 md:gap-4">
        <Stat label="Confirmed" value={data.totals.confirmed} hint="Ticket-days · tickets × days" />
        <Stat label="Pending" value={data.totals.pending} hint="Ticket-days · tickets × days" />
        {finances && <>
          <Stat label="Net revenue" value={inr(finances.net_revenue)} hint="Includes membership contributions; excludes partner GST" />
          <Stat label="Expenses" value={inr(finances.expenses)} hint="Recorded expenses for this edition" />
          <Stat label={finances.profit < 0 ? 'Loss to date' : 'Profit to date'} value={inr(Math.abs(finances.profit))} negative={finances.profit < 0} hint="Net revenue minus recorded expenses" />
          <Stat label="Registrations to break even" value={finances.registrations_to_break_even ?? '—'} hint={finances.average_ticket_income !== null && finances.average_ticket_income > 0
            ? `At ${inr(finances.average_ticket_income)} average income per ticket, including memberships and excluding desk entries. Assumes one ticket per registration and no further costs.`
            : 'Needs confirmed ticket income, from registrations other than desk entries, to estimate. Membership contributions count toward ticket income.'} />
        </>}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SpotBar label="Saturday (day1)" s={data.spots_by_day.day1} />
        <SpotBar label="Sunday (day2)" s={data.spots_by_day.day2} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Recent registrations</h2>
          <div className="space-y-2 text-sm">
            {data.recent_registrations.map((registration) => (
              <div key={registration.id} className="flex flex-col items-start gap-1 border-b pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span>{registration.users?.name || registration.user_phone}</span>
                <span className="text-muted-foreground">{registration.pass_type} · {registration.payment_status}</span>
              </div>
            ))}
            {data.recent_registrations.length === 0 && <p className="text-muted-foreground">No registrations yet.</p>}
          </div>
        </section>
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Recent leads</h2>
          <div className="space-y-2 text-sm">
            {data.recent_leads.map((lead) => (
              <div key={lead.id} className="flex flex-col items-start gap-1 border-b pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span>{lead.name || lead.phone}</span>
                <span className="text-muted-foreground">{lead.step_reached}{lead.converted_at ? ' · converted' : ''}</span>
              </div>
            ))}
            {data.recent_leads.length === 0 && <p className="text-muted-foreground">No leads yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, negative = false }: { label: string; value: number | string; hint?: string; negative?: boolean }) {
  return <div className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">{label}</div><div className={`text-2xl font-bold ${negative ? 'text-destructive' : ''}`}>{value}</div>{hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}</div>;
}
function SpotBar({ label, s }: { label: string; s: { capacity: number; reserved: number; remaining: number } }) {
  const pct = s.capacity > 0 ? Math.min(100, Math.round((s.reserved / s.capacity) * 100)) : 0;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex justify-between text-sm"><span>{label}</span><span>{s.remaining} left</span></div>
      <div className="h-3 w-full rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: pct + '%' }} /></div>
      <div className="mt-1 text-xs text-muted-foreground">{s.reserved} reserved / {s.capacity}</div>
    </div>
  );
}
