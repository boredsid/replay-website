import { LayoutDashboard, Ticket, UserPlus, ScrollText, Calendar, Users, CalendarDays } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/editions', label: 'Editions', icon: Calendar, end: false },
  { to: '/programme', label: 'Programme', icon: CalendarDays, end: false },
  { to: '/registrations', label: 'Registrations', icon: Ticket, end: false },
  { to: '/users', label: 'Users', icon: Users, end: false },
  { to: '/leads', label: 'Leads', icon: UserPlus, end: false },
  { to: '/audit', label: 'Audit', icon: ScrollText, end: false },
] as const;
