import { describe, expect, it } from 'vitest';
import { navFor, landingFor, mobilePrimaryFor } from './nav';

const to = (roles: string[]) => navFor(roles).map((item) => item.to);

describe('the events board in the nav', () => {
  it('is offered to every member of staff, whatever desk they work', () => {
    for (const role of ['admin', 'basic_admin', 'read_only', 'check_in', 'library', 'programme']) {
      expect(to([role])).toContain('/events');
    }
  });
});

describe('read only', () => {
  it('sees the four pages it can open and nothing else', () => {
    expect(to(['read_only']).sort())
      .toEqual(['/announcements', '/events', '/programme', '/registrations']);
  });

  it('is not offered the dashboard, which is not part of that floor', () => {
    expect(to(['read_only'])).not.toContain('/');
    // Every other role still holds it, so nothing changed for them.
    for (const role of ['check_in', 'library', 'programme']) {
      expect(to([role])).toContain('/');
    }
  });

  it('is not offered the staff page, which only full admins reach', () => {
    expect(to(['read_only'])).not.toContain('/staff');
    expect(to(['basic_admin'])).not.toContain('/staff');
    expect(to(['admin'])).toContain('/staff');
  });

  it('still gets a bottom bar with something in it', () => {
    expect(mobilePrimaryFor(['read_only']).length).toBeGreaterThan(0);
  });
});

describe('where somebody lands', () => {
  it('is the dashboard for anybody who holds it', () => {
    for (const role of ['admin', 'basic_admin', 'check_in', 'library', 'programme']) {
      expect(landingFor([role])).toBe('/');
    }
  });

  it('is the first page they can open for somebody who does not', () => {
    // Otherwise the one role least able to work out why would open the app on
    // a page that 403s.
    const landing = landingFor(['read_only']);
    expect(landing).not.toBe('/');
    expect(to(['read_only'])).toContain(landing);
  });

  it('sends a role nobody classified somewhere it can actually open', () => {
    // Not the dashboard, which an unclassified role cannot read.
    const landing = landingFor(['something_new']);
    expect(to(['something_new'])).toContain(landing);
  });
});
