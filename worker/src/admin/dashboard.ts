import type { Env } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminJson } from './auth';
import { getEditionBySlug, getCurrentEdition } from '../editions';
import { summarizeFinance, type FinanceSnapshot } from './finance';

export function dashboardFinances(snapshot: FinanceSnapshot) {
  const summary = summarizeFinance(snapshot).summary;
  // The summary's average already leaves desk entries out; break-even works from
  // the same totals rather than the rounded average, which can push an exact
  // boundary up by one ticket.
  const ticketIncomePaise = Math.round(summary.ticket_income * 100) + Math.round(summary.bgc_income * 100) - Math.round(summary.desk_ticket_income * 100);
  const tickets = summary.confirmed_tickets - summary.desk_tickets;
  const registrationsToBreakEven = summary.shortfall <= 0 ? 0
    : ticketIncomePaise > 0 && tickets > 0
      ? Math.ceil(Math.round(summary.shortfall * 100) * tickets / ticketIncomePaise)
      : null;
  return {
    net_revenue: summary.net_revenue,
    expenses: summary.expenses,
    profit: summary.profit,
    average_ticket_income: summary.average_ticket_income,
    registrations_to_break_even: registrationsToBreakEven,
  };
}

export async function handleDashboard(req: Request, env: Env, sb: SupabaseClient, origin: string, includeFinance = false): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('edition');
  const edition = slug ? await getEditionBySlug(env, slug) : await getCurrentEdition(env);
  if (!edition) return adminJson({ error: 'no_edition' }, 404, origin);

  // The same uncapped, edition-scoped snapshot used by Finances keeps money,
  // ticket-days and capacity consistent even beyond 1,000 registrations.
  const { data, error } = await sb.rpc('finance_snapshot', { p_edition_id: edition.id });
  if (error || !data) return adminJson({ error: 'dashboard_totals_failed' }, 500, origin);
  const snapshot = data as FinanceSnapshot;
  if (!snapshot.edition || snapshot.edition.id !== edition.id) return adminJson({ error: 'no_edition' }, 404, origin);
  const seats = { day1: 0, day2: 0 };
  const totals = { confirmed: 0, pending: 0, cancelled: 0, revenue: 0 };
  for (const row of snapshot.registrations) {
    if (row.payment_status === 'cancelled') { totals.cancelled++; continue; }
    if (row.payment_status !== 'confirmed' && row.payment_status !== 'pending') continue;
    totals[row.payment_status] += row.seats * row.days.length;
    if (row.days.includes('day1')) seats.day1 += row.seats;
    if (row.days.includes('day2')) seats.day2 += row.seats;
  }
  let finances: ReturnType<typeof dashboardFinances> | null = null;
  if (includeFinance) {
    try { finances = dashboardFinances(snapshot); }
    catch { return adminJson({ error: 'finance_totals_failed' }, 503, origin); }
    // Retain the old fields during deployment for already-open dashboard tabs.
    // The new UI uses finances and no longer displays cancelled registrations.
    totals.revenue = finances.net_revenue;
  }
  const cap = snapshot.edition.capacity_per_day;
  const spots_by_day = {
    day1: { capacity: cap.day1, reserved: seats.day1, remaining: Math.max(0, cap.day1 - seats.day1) },
    day2: { capacity: cap.day2, reserved: seats.day2, remaining: Math.max(0, cap.day2 - seats.day2) },
  };

  const recentRegsRes = await sb
    .from('registrations')
    .select('id, user_phone, pass_type, days, payment_status, created_at, users(name)')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const recentLeadsRes = await sb
    .from('leads')
    .select('*')
    .eq('edition_id', edition.id)
    .order('created_at', { ascending: false })
    .limit(10);
  if (recentRegsRes.error || recentLeadsRes.error) return adminJson({ error: 'recent_activity_failed' }, 500, origin);

  return adminJson(
    {
      edition: { id: edition.id, slug: edition.slug, name: edition.name, registration_status: edition.registration_status },
      spots_by_day,
      totals,
      finances,
      recent_registrations: recentRegsRes.data ?? [],
      recent_leads: recentLeadsRes.data ?? [],
    },
    200,
    origin,
  );
}
