import { LayoutDashboard, Ticket, UserPlus, ScrollText, Calendar, Users, CalendarDays, Handshake, Megaphone } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', mobileLabel: 'Home', icon: LayoutDashboard, end: true, mobile: 'primary', mobileOrder: 0 },
  { to: '/editions', label: 'Editions', mobileLabel: 'Editions', icon: Calendar, end: false, mobile: 'more', mobileOrder: 0 },
  { to: '/programme', label: 'Programme', mobileLabel: 'Schedule', icon: CalendarDays, end: false, mobile: 'primary', mobileOrder: 2 },
  { to: '/announcements', label: 'Announcements', mobileLabel: 'Notices', icon: Megaphone, end: false, mobile: 'primary', mobileOrder: 3 },
  { to: '/registrations', label: 'Registrations', mobileLabel: 'Tickets', icon: Ticket, end: false, mobile: 'primary', mobileOrder: 1 },
  { to: '/partners', label: 'Partners', mobileLabel: 'Partners', icon: Handshake, end: false, mobile: 'more', mobileOrder: 1 },
  { to: '/users', label: 'Users', mobileLabel: 'Users', icon: Users, end: false, mobile: 'more', mobileOrder: 2 },
  { to: '/leads', label: 'Leads', mobileLabel: 'Leads', icon: UserPlus, end: false, mobile: 'more', mobileOrder: 3 },
  { to: '/audit', label: 'Audit', mobileLabel: 'Audit', icon: ScrollText, end: false, mobile: 'more', mobileOrder: 4 },
] as const;

export const MOBILE_PRIMARY_NAV = NAV
  .filter((item) => item.mobile === 'primary')
  .sort((a, b) => a.mobileOrder - b.mobileOrder);
export const MOBILE_MORE_NAV = NAV
  .filter((item) => item.mobile === 'more')
  .sort((a, b) => a.mobileOrder - b.mobileOrder);
