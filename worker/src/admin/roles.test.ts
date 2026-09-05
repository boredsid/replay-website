import { describe, it, expect } from 'vitest';
import { mayReach, rolesForPath, hasFullAccess } from './roles';

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
    for (const path of ['/api/admin/promo-codes', '/api/admin/users', '/api/admin/editions']) {
      expect(mayReach(['check_in'], path)).toBe(false);
    }
    // Bookings are the exception: readable by anyone on staff, and never
    // writable by them. What is kept from them there is the money, which the
    // redaction handles rather than the route map.
    expect(mayReach(['check_in'], '/api/admin/registrations', 'GET')).toBe(true);
    expect(mayReach(['check_in'], '/api/admin/registrations', 'PATCH')).toBe(false);
    expect(hasFullAccess(['check_in'], '/api/admin/registrations')).toBe(false);
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

  it('gives programme editors the schedule and notices to change', () => {
    expect(hasFullAccess(['programme'], '/api/admin/schedule')).toBe(true);
    expect(hasFullAccess(['programme'], '/api/admin/announcements')).toBe(true);
    // The library desk may read a notice but not write one.
    expect(hasFullAccess(['library'], '/api/admin/announcements')).toBe(false);
    expect(mayReach(['library'], '/api/admin/announcements', 'POST')).toBe(false);
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


describe('basic admin', () => {
  it('reaches everything a full admin does', () => {
    for (const path of ['/api/admin/users', '/api/admin/promo-codes', '/api/admin/check-in',
                        '/api/admin/library/checkout', '/api/admin/editions', '/api/admin/audit']) {
      expect(mayReach(['basic_admin'], path, 'POST')).toBe(true);
    }
  });

  it('cannot reach the staff table, which is the whole point', () => {
    // A role that can edit staff can grant itself every other role, so this is
    // the only real privilege boundary in the system.
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(mayReach(['basic_admin'], '/api/admin/staff', method)).toBe(false);
      expect(mayReach(['basic_admin'], '/api/admin/staff/someone@example.com', method)).toBe(false);
    }
  });

  it('reaches a route nobody classified, unlike a desk role', () => {
    expect(mayReach(['basic_admin'], '/api/admin/something-new', 'POST')).toBe(true);
    expect(mayReach(['check_in'], '/api/admin/something-new', 'POST')).toBe(false);
  });
});

describe('what every member of staff can read', () => {
  const desks = ['check_in', 'library', 'programme'];

  it('lets any desk read the programme, notices and bookings', () => {
    for (const role of desks) {
      for (const path of ['/api/admin/schedule', '/api/admin/announcements', '/api/admin/registrations']) {
        expect(mayReach([role], path, 'GET')).toBe(true);
      }
    }
  });

  it('is read-only: the same paths refuse every other method', () => {
    // Otherwise a page somebody can look at becomes a page they can change by
    // finding the right button.
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      expect(mayReach(['library'], '/api/admin/registrations', method)).toBe(false);
      expect(mayReach(['check_in'], '/api/admin/announcements', method)).toBe(false);
    }
  });

  it('still lets the role that owns a page write to it', () => {
    expect(mayReach(['programme'], '/api/admin/announcements', 'POST')).toBe(true);
    expect(mayReach(['programme'], '/api/admin/schedule', 'PATCH')).toBe(true);
  });

  it('does not extend to anything else', () => {
    // Reading bookings is not reading everything.
    for (const path of ['/api/admin/users', '/api/admin/promo-codes', '/api/admin/audit', '/api/admin/leads']) {
      expect(mayReach(['library'], path, 'GET')).toBe(false);
    }
  });
});

describe('hasFullAccess', () => {
  it('separates looking from changing', () => {
    // The redaction hangs off this: a read-only viewer of bookings gets them
    // without the money or the full number.
    expect(hasFullAccess(['library'], '/api/admin/registrations')).toBe(false);
    expect(hasFullAccess(['admin'], '/api/admin/registrations')).toBe(true);
    expect(hasFullAccess(['basic_admin'], '/api/admin/registrations')).toBe(true);
  });
});
