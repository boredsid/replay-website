import { describe, it, expect } from 'vitest';
import { mayReach, rolesForPath } from './roles';

describe('what a role reaches', () => {
  it('lets admin everywhere, including places with no rule', () => {
    for (const path of ['/api/admin/users', '/api/admin/staff', '/api/admin/promo-codes', '/api/admin/check-in']) {
      expect(mayReach(['admin'], path)).toBe(true);
    }
  });

  it('fails closed for a route nobody classified', () => {
    // A route added later without a rule must be admin-only, not open. This is
    // the property that keeps the map from rotting into a hole.
    expect(rolesForPath('/api/admin/something-new')).toEqual([]);
    for (const role of ['check_in', 'library', 'programme']) {
      expect(mayReach([role], '/api/admin/something-new')).toBe(false);
    }
  });

  it('keeps the check-in desk out of money and people', () => {
    for (const path of ['/api/admin/promo-codes', '/api/admin/registrations', '/api/admin/users', '/api/admin/editions']) {
      expect(mayReach(['check_in'], path)).toBe(false);
    }
  });

  it('keeps the library desk out of the check-in desk', () => {
    expect(mayReach(['library'], '/api/admin/check-in')).toBe(false);
    expect(mayReach(['library'], '/api/admin/check-in/bulk')).toBe(false);
  });

  it('lets both desks scan a pass, because both start there', () => {
    expect(mayReach(['check_in'], '/api/admin/scan')).toBe(true);
    expect(mayReach(['library'], '/api/admin/scan')).toBe(true);
    expect(mayReach(['programme'], '/api/admin/scan')).toBe(false);
  });

  it('gives the library desk its own routes and no others', () => {
    expect(mayReach(['library'], '/api/admin/library/checkout')).toBe(true);
    expect(mayReach(['library'], '/api/admin/library/withdrawn')).toBe(true);
    expect(mayReach(['check_in'], '/api/admin/library/checkout')).toBe(false);
  });

  it('gives programme editors the schedule and notices', () => {
    expect(mayReach(['programme'], '/api/admin/schedule')).toBe(true);
    expect(mayReach(['programme'], '/api/admin/announcements')).toBe(true);
    expect(mayReach(['library'], '/api/admin/announcements')).toBe(false);
  });

  it('lets the check-in desk reach a session roster', () => {
    // Somebody at the door asks to be added to a session; the desk can do it.
    expect(mayReach(['check_in'], '/api/admin/sessions/attendees')).toBe(true);
  });

  it('lets everyone signed in read whoami, or the app cannot draw itself', () => {
    for (const role of ['check_in', 'library', 'programme']) {
      expect(mayReach([role], '/api/admin/whoami')).toBe(true);
    }
  });

  it('keeps staff management to admins alone', () => {
    // Otherwise a volunteer can grant themselves anything, which makes the
    // whole table decorative.
    for (const role of ['check_in', 'library', 'programme']) {
      expect(mayReach([role], '/api/admin/staff')).toBe(false);
      expect(mayReach([role], '/api/admin/staff/someone@example.com')).toBe(false);
    }
  });

  it('lets somebody hold two roles, as a volunteer covering two desks does', () => {
    const both = ['check_in', 'library'];
    expect(mayReach(both, '/api/admin/check-in')).toBe(true);
    expect(mayReach(both, '/api/admin/library/loans')).toBe(true);
    expect(mayReach(both, '/api/admin/users')).toBe(false);
  });

  it('refuses somebody with no roles at all', () => {
    expect(mayReach([], '/api/admin/whoami')).toBe(false);
    expect(mayReach([], '/api/admin/check-in')).toBe(false);
  });

  it('takes the longest matching prefix, so a sub-path can differ', () => {
    expect(rolesForPath('/api/admin/library/loans')).toContain('library');
    expect(rolesForPath('/api/admin/check-in/roster')).toContain('check_in');
  });
});
