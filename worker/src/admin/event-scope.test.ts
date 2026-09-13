import { describe, it, expect } from 'vitest';
import { eventScopes, eventWriteScope, scopeAllows } from './event-scope';
import type { StaffMember } from './roles';

const S1 = 'b1111111-1111-1111-1111-111111111111';
const S2 = 'b2222222-2222-2222-2222-222222222222';

function staff(roles: string[]): StaffMember {
  return { email: 'Runner@Replaycon.in', name: 'Runner', roles: roles as StaffMember['roles'] };
}

/** Records what was asked for, so the lowercasing can be asserted. */
function client(assigned: string[], options: { error?: boolean; seen?: string[] } = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: async (_column: string, email: string) => {
          options.seen?.push(email);
          return options.error
            ? { data: null, error: { message: 'boom' } }
            : { data: assigned.map((id) => ({ schedule_item_id: id })), error: null };
        },
      }),
    }),
  } as never;
}

describe('what an event manager may see', () => {
  it('is the sessions named for them, and nothing else', async () => {
    const scope = (await eventScopes(client([S1]), staff(['event_manager']))).read;
    expect(scope).not.toBeNull();
    expect([...scope!]).toEqual([S1]);
    expect(scopeAllows(scope, S1)).toBe(true);
    expect(scopeAllows(scope, S2)).toBe(false);
  });

  it('is nothing at all when nobody has named any', async () => {
    // The assignment is the grant, so an event manager with no rows sees an
    // empty board rather than the whole edition.
    const scope = (await eventScopes(client([]), staff(['event_manager']))).read;
    expect(scope?.size).toBe(0);
  });

  it('is nothing at all when the lookup fails', async () => {
    // A failed read must not widen anybody. Showing them nothing is a page
    // they can reload; showing them everything is not recoverable.
    const scope = (await eventScopes(client([S1], { error: true }), staff(['event_manager']))).read;
    expect(scope?.size).toBe(0);
  });

  it('matches the staff row however the address was capitalised', async () => {
    const seen: string[] = [];
    await eventScopes(client([], { seen }), staff(['event_manager']));
    expect(seen).toEqual(['runner@replaycon.in']);
  });

  it('is the whole board for the two admin roles', async () => {
    for (const role of ['admin', 'basic_admin']) {
      expect((await eventScopes(client([S1]), staff([role, 'event_manager']))).read).toBeNull();
    }
  });

  it('is the whole board for a role that already reads every booking', async () => {
    // Somebody who works the check-in desk *and* runs a tournament already sees
    // every booking in the edition through the desk. The second role must not
    // make them blinder than the first left them.
    const scope = (await eventScopes(client([S1]), staff(['check_in', 'event_manager']))).read;
    expect(scope).toBeNull();
  });

  it('does not restrict anybody who is not an event manager', async () => {
    for (const roles of [['read_only'], ['programme'], ['library']]) {
      expect((await eventScopes(client([]), staff(roles))).read).toBeNull();
    }
  });
});

describe('what an event manager may change', () => {
  it('stays their own sessions even when a desk widens what they can read', async () => {
    // The narrower of the two, deliberately: holding a desk widens what they
    // look at and must never widen what they rewrite.
    const scope = await eventWriteScope(client([S1]), staff(['check_in', 'event_manager']));
    expect([...scope!]).toEqual([S1]);
  });

  it('is unrestricted only for the admin roles', async () => {
    expect(await eventWriteScope(client([S1]), staff(['admin']))).toBeNull();
    expect(await eventWriteScope(client([S1]), staff(['basic_admin', 'event_manager']))).toBeNull();
  });
});

describe('scopeAllows', () => {
  it('allows everything when there is no restriction', () => {
    expect(scopeAllows(null, S1)).toBe(true);
    expect(scopeAllows(null, 'anything')).toBe(true);
  });

  it('allows nothing when the restriction is empty', () => {
    expect(scopeAllows(new Set(), S1)).toBe(false);
  });
});
