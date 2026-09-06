export interface FinanceAccount {
  id: string; name: string; staff_email: string; automatic_income: boolean; active: boolean;
  income: number; expenses: number; balance: number; bgc: number;
}
export interface FinanceEntry {
  id: string; edition_id: string; account_id: string; kind: 'income' | 'expense'; amount: number;
  description: string; category: string; entry_date: string; notes: string;
  created_by: string; updated_by: string; updated_at: string; voided_at: string | null; void_reason: string | null;
}
export interface FinanceReport {
  edition: { id: string; name: string; slug: string; pricing: { oneshot?: unknown } };
  accounts: FinanceAccount[]; entries: FinanceEntry[];
  automatic: { id: string; source_id: string; source: 'registration' | 'partner' | 'bgc'; description: string; amount: number; account_id: string; entry_date: string }[];
  summary: {
    ticket_income: number; bgc_income: number; partner_income: number; partner_gst: number; manual_income: number;
    income: number; net_revenue: number; expenses: number; profit: number; shortfall: number; pending_income: number;
    confirmed_tickets: number; average_ticket_income: number | null; remaining_day_tickets: number;
  };
}
export function breakEven(shortfall: number, ticketIncome: number, variableCost: number): number | null {
  if (shortfall <= 0) return 0;
  if (![ticketIncome, variableCost].every(Number.isFinite) || ticketIncome < 0 || variableCost < 0) return null;
  const contribution = Math.round(ticketIncome * 100) - Math.round(variableCost * 100);
  return contribution > 0 ? Math.ceil(Math.round(shortfall * 100) / contribution) : null;
}
