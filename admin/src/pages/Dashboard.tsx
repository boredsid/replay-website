import { useEffect, useState } from 'react';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { DashboardData } from '@/lib/types';
import { Loading } from '@/components/Loading';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { fetchAdmin<DashboardData>('/api/admin/dashboard').then(setData).catch(showApiError); }, []);
  if (!data) return <Loading><span className="text-muted-foreground text-sm">Loading…</span></Loading>;
  const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">{data.edition.name} · {data.edition.registration_status}</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Confirmed" value={data.totals.confirmed} />
        <Stat label="Pending" value={data.totals.pending} />
        <Stat label="Cancelled" value={data.totals.cancelled} />
        <Stat label="Revenue" value={inr(data.totals.revenue)} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SpotBar label="Saturday (day1)" s={data.spots_by_day.day1} />
        <SpotBar label="Sunday (day2)" s={data.spots_by_day.day2} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-2xl font-bold">{value}</div></div>;
}
function SpotBar({ label, s }: { label: string; s: { capacity: number; confirmed: number; remaining: number } }) {
  const pct = Math.min(100, Math.round((s.confirmed / s.capacity) * 100));
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex justify-between text-sm"><span>{label}</span><span>{s.remaining} left</span></div>
      <div className="h-3 w-full rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: pct + '%' }} /></div>
      <div className="mt-1 text-xs text-muted-foreground">{s.confirmed} / {s.capacity}</div>
    </div>
  );
}
