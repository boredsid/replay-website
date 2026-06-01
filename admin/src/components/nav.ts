import { LayoutDashboard, Ticket, UserPlus, ScrollText } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/registrations', label: 'Registrations', icon: Ticket, end: false },
  { to: '/leads', label: 'Leads', icon: UserPlus, end: false },
  { to: '/audit', label: 'Audit', icon: ScrollText, end: false },
] as const;
