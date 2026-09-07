import { describe, expect, it } from 'vitest';
import { reconcileRoles, sameRoles, orderRoles } from './staff-roles';
import type { Role } from './whoami';

describe('picking an umbrella role', () => {
  it('drops the desks it already contains', () => {
    expect(reconcileRoles(['check_in', 'library'], 'admin')).toEqual(['admin']);
    expect(reconcileRoles(['check_in', 'library'], 'basic_admin')).toEqual(['basic_admin']);
  });

  it('swaps one umbrella for the other', () => {
    // Full admin contains basic admin, so holding both says nothing extra.
    expect(reconcileRoles(['basic_admin'], 'admin')).toEqual(['admin']);
    expect(reconcileRoles(['admin'], 'basic_admin')).toEqual(['basic_admin']);
  });

  it('drops programme too, which basic admin also contains', () => {
    expect(reconcileRoles(['programme'], 'basic_admin')).toEqual(['basic_admin']);
  });
});

describe('picking a desk while holding an umbrella', () => {
  it('drops the umbrella, because the obvious reading is "narrow this person"', () => {
    expect(reconcileRoles(['admin'], 'check_in')).toEqual(['check_in']);
    expect(reconcileRoles(['basic_admin'], 'library')).toEqual(['library']);
  });
});

describe('desks are siblings, not a hierarchy', () => {
  it('lets somebody hold two, which is what covering two desks looks like', () => {
    expect(reconcileRoles(['check_in'], 'library')).toEqual(['check_in', 'library']);
  });

  it('lets somebody hold all three', () => {
    const roles = reconcileRoles(reconcileRoles(['check_in'], 'library'), 'programme');
    expect(roles).toEqual(['check_in', 'library', 'programme']);
  });

  it('does not drop a sibling when a third is added', () => {
    // The library desk is not a superset of check-in, so nothing is redundant.
    expect(reconcileRoles(['check_in', 'library'], 'programme'))
      .toEqual(['check_in', 'library', 'programme']);
  });
});

describe('turning a role off', () => {
  it('removes only that one', () => {
    expect(reconcileRoles(['check_in', 'library'], 'check_in')).toEqual(['library']);
  });

  it('can empty the set, which the form then refuses to save', () => {
    expect(reconcileRoles(['admin'], 'admin')).toEqual([]);
  });
});

describe('sameRoles', () => {
  it('ignores order, so a reordered draft is not a change', () => {
    expect(sameRoles(['check_in', 'library'], ['library', 'check_in'])).toBe(true);
  });

  it('notices a real difference', () => {
    expect(sameRoles(['check_in'], ['check_in', 'library'])).toBe(false);
    expect(sameRoles(['check_in'], ['library'])).toBe(false);
    expect(sameRoles([], ['library'])).toBe(false);
  });
});

describe('orderRoles', () => {
  it('sorts by privilege so a saved set and a draft compare by eye', () => {
    const shuffled: Role[] = ['programme', 'admin', 'library'];
    expect(orderRoles(shuffled)).toEqual(['admin', 'library', 'programme']);
  });
});

describe('read only', () => {
  it('is dropped by any desk, because every desk already contains it', () => {
    // Read only is the shared read-only floor, not a fourth desk. Holding it
    // beside check-in would show a permission set that says less than it looks.
    expect(reconcileRoles(['read_only'], 'check_in')).toEqual(['check_in']);
    expect(reconcileRoles(['read_only'], 'library')).toEqual(['library']);
    expect(reconcileRoles(['read_only'], 'programme')).toEqual(['programme']);
  });

  it('drops the desks when picked, narrowing the person', () => {
    expect(reconcileRoles(['check_in', 'library'], 'read_only')).toEqual(['read_only']);
    expect(reconcileRoles(['programme'], 'read_only')).toEqual(['read_only']);
  });

  it('is dropped by either umbrella too', () => {
    expect(reconcileRoles(['read_only'], 'admin')).toEqual(['admin']);
    expect(reconcileRoles(['read_only'], 'basic_admin')).toEqual(['basic_admin']);
    expect(reconcileRoles(['admin'], 'read_only')).toEqual(['read_only']);
  });

  it('can be turned off like any other role', () => {
    expect(reconcileRoles(['read_only'], 'read_only')).toEqual([]);
  });

  it('sorts between the umbrellas and the desks', () => {
    expect(orderRoles(['programme', 'read_only', 'admin'] as Role[]))
      .toEqual(['admin', 'read_only', 'programme']);
  });
});
