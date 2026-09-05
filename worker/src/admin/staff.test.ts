import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./audit', () => ({ writeAudit: vi.fn() }));
vi.mock('./access-group', () => ({ syncAccessFromStaff: vi.fn() }));

import { handleStaffList, handleStaffCreate, handleStaffUpdate, handleStaffRemove } from './staff';
import { writeAudit } from './audit';
import { syncAccessFromStaff } from './access-group';

const ORIGIN = 'https://admin.replaycon.in';
const ME = 'siddhantnarula96@gmail.com';
const env = {} as never;

const audit = writeAudit as unknown as ReturnType<typeof vi.fn>;
const sync = syncAccessFromStaff as unknown as ReturnType<typeof vi.fn>;

function post(body: unknown) {
  return new Request('https://api/api/admin/staff', { method: 'POST', body: JSON.stringify(body) });
}
function patch(body: unknown) {
  return new Request('https://api/api/admin/staff/x', { method: 'PATCH', body: JSON.stringify(body) });
}

/** A client whose write either succeeds or fails with a database message. */
function client(options: { error?: string; rows?: unknown[] } = {}) {
  const result = { data: options.error ? null : (options.rows ?? [{ email: 'v@replaycon.in' }]),
                   error: options.error ? { message: options.error } : null };
  return {
    from: () => ({
      insert: async () => result,
      update: () => ({ eq: () => ({ select: async () => result }) }),
      delete: () => ({ eq: () => ({ select: async () => result }) }),
      select: () => ({ order: async () => ({ data: options.rows ?? [], error: null }) }),
    }),
  } as never;
}

beforeEach(() => {
  audit.mockReset();
  sync.mockReset();
  sync.mockResolvedValue({ synced: true, members: 3 });
});

describe('adding somebody', () => {
  it('stores them, records who did it, and pushes the perimeter', async () => {
    const sb = client();
    const response = await handleStaffCreate(
      post({ email: 'Volunteer@Replaycon.in', name: 'Vol', roles: ['check_in'] }), env, sb, ME, ORIGIN,
    );
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({ action: 'staff.add', actor_email: ME }));
    expect(sync).toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ access_sync: { synced: true } });
  });

  it('refuses an address that is not one', async () => {
    const sb = client();
    for (const email of ['nope', 'a@b', '', '   ']) {
      expect((await handleStaffCreate(post({ email, roles: ['check_in'] }), env, sb, ME, ORIGIN)).status).toBe(400);
    }
  });

  it('refuses a role it does not recognise', async () => {
    // Otherwise a typo becomes a role nothing grants and nobody notices.
    const response = await handleStaffCreate(
      post({ email: 'v@replaycon.in', roles: ['libary'] }), env, client(), ME, ORIGIN,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'no_roles' });
  });

  it('refuses somebody with no roles, which would mean nothing at all', async () => {
    expect((await handleStaffCreate(post({ email: 'v@replaycon.in', roles: [] }), env, client(), ME, ORIGIN)).status).toBe(400);
  });

  it('reports somebody already on the list as a conflict', async () => {
    const response = await handleStaffCreate(
      post({ email: 'v@replaycon.in', roles: ['library'] }), env,
      client({ error: 'duplicate key value violates unique constraint' }), ME, ORIGIN,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'already_staff' });
  });

  it('still says they were added when the perimeter sync failed', async () => {
    // The staff table is the authority; a Cloudflare outage must not stop you
    // changing who works your own desk. The screen is told, and can say so.
    sync.mockResolvedValue({ synced: false, reason: 'failed', detail: 'write 500' });
    const response = await handleStaffCreate(
      post({ email: 'v@replaycon.in', roles: ['library'] }), env, client(), ME, ORIGIN,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, access_sync: { synced: false, reason: 'failed' } });
  });
});

describe('changing what somebody may do', () => {
  it('updates their roles', async () => {
    const sb = client();
    const response = await handleStaffUpdate(patch({ roles: ['library', 'check_in'] }), env, sb, 'v@replaycon.in', ME, ORIGIN);
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({ action: 'staff.update' }));
  });

  it('refuses to let you take away your own admin', async () => {
    // The one mistake that cannot be undone from this screen.
    const response = await handleStaffUpdate(patch({ roles: ['check_in'] }), env, client(), ME, ME, ORIGIN);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'cannot_demote_self' });
  });

  it('lets you change your own name and keep admin', async () => {
    const response = await handleStaffUpdate(patch({ roles: ['admin'], name: 'Sid' }), env, client(), ME, ME, ORIGIN);
    expect(response.status).toBe(200);
  });

  it('passes the last-admin rule through as something readable', async () => {
    const response = await handleStaffUpdate(
      patch({ roles: ['check_in'] }), env, client({ error: 'last_admin' }), 'other@replaycon.in', ME, ORIGIN,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'last_admin' });
  });

  it('reports somebody who is not on the list', async () => {
    const response = await handleStaffUpdate(patch({ roles: ['library'] }), env, client({ rows: [] }), 'ghost@replaycon.in', ME, ORIGIN);
    expect(response.status).toBe(404);
  });
});

describe('removing somebody', () => {
  it('removes them and re-syncs the perimeter', async () => {
    const sb = client();
    const response = await handleStaffRemove(env, sb, 'v@replaycon.in', ME, ORIGIN);
    expect(response.status).toBe(200);
    expect(sync).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(sb, expect.objectContaining({ action: 'staff.remove' }));
  });

  it('refuses to let you remove yourself', async () => {
    const response = await handleStaffRemove(env, client(), ME, ME, ORIGIN);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'cannot_remove_self' });
  });

  it('passes the last-admin rule through', async () => {
    const response = await handleStaffRemove(env, client({ error: 'last_admin' }), 'other@replaycon.in', ME, ORIGIN);
    expect(response.status).toBe(409);
  });

  it('does not write an audit row for a removal that did not happen', async () => {
    await handleStaffRemove(env, client({ rows: [] }), 'ghost@replaycon.in', ME, ORIGIN);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('listing', () => {
  it('returns everyone with their roles', async () => {
    const rows = [{ email: ME, name: 'Siddhant', roles: ['admin'], added_by: 'migration', created_at: '' }];
    const body = await (await handleStaffList(client({ rows }), ORIGIN)).json() as { staff: unknown[] };
    expect(body.staff).toEqual(rows);
  });
});
