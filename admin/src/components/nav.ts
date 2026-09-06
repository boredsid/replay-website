import { LayoutDashboard, Ticket, UserPlus, ScrollText, Calendar, Users, CalendarDays, Handshake, Megaphone, ImageIcon, TicketPercent, UserCheck, Library, ShieldCheck, Wallet } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', mobileLabel: 'Home', icon: LayoutDashboard, end: true, mobile: 'primary', mobileOrder: 0, roles: ['check_in', 'library', 'programme'] },
  { to: '/editions', label: 'Editions', mobileLabel: 'Editions', icon: Calendar, end: false, mobile: 'more', mobileOrder: 1 },
  { to: '/check-in', label: 'Check in', mobileLabel: 'Check in', icon: UserCheck, end: false, mobile: 'primary', mobileOrder: 1, roles: ['check_in'] },
  { to: '/library', label: 'Game library', mobileLabel: 'Library', icon: Library, end: false, mobile: 'primary', mobileOrder: 2, roles: ['library'] },
  { to: '/programme', label: 'Programme', mobileLabel: 'Schedule', icon: CalendarDays, end: false, mobile: 'more', mobileOrder: 0, roles: ['programme'] },
  { to: '/announcements', label: 'Announcements', mobileLabel: 'Notices', icon: Megaphone, end: false, mobile: 'primary', mobileOrder: 4, roles: ['programme'] },
  { to: '/registrations', label: 'Registrations', mobileLabel: 'Tickets', icon: Ticket, end: false, mobile: 'primary', mobileOrder: 3 },
  { to: '/promos', label: 'Promo codes', mobileLabel: 'Promos', icon: TicketPercent, end: false, mobile: 'more', mobileOrder: 2 },
  { to: '/partners', label: 'Partners', mobileLabel: 'Partners', icon: Handshake, end: false, mobile: 'more', mobileOrder: 2 },
  { to: '/finance', label: 'Finances', mobileLabel: 'Finances', icon: Wallet, end: false, mobile: 'more', mobileOrder: 2 },
  { to: '/partner-logos', label: 'Partner logos', mobileLabel: 'Logos', icon: ImageIcon, end: false, mobile: 'more', mobileOrder: 3 },
  { to: '/users', label: 'Users', mobileLabel: 'Users', icon: Users, end: false, mobile: 'more', mobileOrder: 4 },
  { to: '/leads', label: 'Leads', mobileLabel: 'Leads', icon: UserPlus, end: false, mobile: 'more', mobileOrder: 5 },
  { to: '/staff', label: 'Staff', mobileLabel: 'Staff', icon: ShieldCheck, end: false, mobile: 'more', mobileOrder: 6 },
  { to: '/audit', label: 'Audit', mobileLabel: 'Audit', icon: ScrollText, end: false, mobile: 'more', mobileOrder: 7 },
] as const;

/** Pages every signed-in member of staff may read. Writing is still gated. */
const READABLE_BY_ALL: readonly string[] = ['/programme', '/announcements', '/registrations'];

export type NavRole = 'admin' | 'check_in' | 'library' | 'programme';

/**
 * The nav a set of roles should see.
 *
 * An item without `roles` is admin-only, mirroring `rolesForPath` in the
 * Worker: something added and not classified stays hidden rather than showing
 * a link that 403s. This is presentation only — the Worker enforces.
 */
export function navFor(roles: readonly string[]): typeof NAV[number][] {
  if (roles.includes('admin')) return [...NAV];
  // Everything except the one page that can grant roles.
  if (roles.includes('basic_admin')) return NAV.filter((item) => item.to !== '/staff');
  return NAV.filter((item) => {
    const allowed = (item as { roles?: readonly string[] }).roles;
    // Read-only for everyone on staff, so the link is worth showing.
    if (READABLE_BY_ALL.includes(item.to)) return true;
    return Boolean(allowed?.some((role) => roles.includes(role)));
  });
}

export const MOBILE_PRIMARY_NAV = NAV
  .filter((item) => item.mobile === 'primary')
  .sort((a, b) => a.mobileOrder - b.mobileOrder);
export const MOBILE_MORE_NAV = NAV
  .filter((item) => item.mobile === 'more')
  .sort((a, b) => a.mobileOrder - b.mobileOrder);

export function mobilePrimaryFor(roles: readonly string[]) {
  return navFor(roles).filter((item) => item.mobile === 'primary')
    .sort((a, b) => a.mobileOrder - b.mobileOrder);
}
export function mobileMoreFor(roles: readonly string[]) {
  return navFor(roles).filter((item) => item.mobile === 'more')
    .sort((a, b) => a.mobileOrder - b.mobileOrder);
}
