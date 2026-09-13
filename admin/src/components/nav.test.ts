import { describe, expect, it } from 'vitest';
import { navFor, landingFor, mobilePrimaryFor, mobileMoreFor } from './nav';

const to = (roles: string[]) => navFor(roles).map((item) => item.to);

describe('the events board in the nav', () => {
  it('is offered to every member of staff, whatever desk they work', () => {
    for (const role of ['admin', 'basic_admin', 'read_only', 'check_in', 'library', 'programme',
                        'event_manager']) {
      expect(to([role])).toContain('/events');
    }
  });
});

describe('the event manager', () => {
  it('is offered the events board and nothing else at all', () => {
    // The one role without the shared read-only floor: it is granted named
    // sessions rather than pages, so the pages the floor would draw are not
    // there to draw.
    expect(to(['event_manager'])).toEqual(['/events']);
  });

  it('lands on it, since there is nowhere else to land', () => {
    expect(landingFor(['event_manager'])).toBe('/events');
  });

  it('gets a bottom bar with the board in it, not one button called More', () => {
    // Events sits under More for a full admin, whose bar is crowded. For
    // somebody whose whole nav is that one page it has to be promoted.
    expect(mobilePrimaryFor(['event_manager']).map((item) => item.to)).toEqual(['/events']);
    expect(mobileMoreFor(['event_manager'])).toEqual([]);
  });

  it('gets the floor back from a desk they also work', () => {
    const both = to(['check_in', 'event_manager']);
    expect(both).toContain('/events');
    expect(both).toContain('/check-in');
    expect(both).toContain('/registrations');
  });

  it('leaves every other bar exactly as it was', () => {
    expect(mobilePrimaryFor(['check_in']).map((item) => item.to)).toContain('/check-in');
    expect(mobileMoreFor(['admin']).map((item) => item.to)).toContain('/events');
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

  it('leaves a role nobody classified at the root, with the honest error', () => {
    // An unclassified role now reaches nothing at all — the shared read floor
    // is an allowlist, so a role added and not classified fails closed. There
    // is no page to send them to, so they get the dashboard's own message.
    expect(to(['something_new'])).toEqual([]);
    expect(landingFor(['something_new'])).toBe('/');
  });
});
