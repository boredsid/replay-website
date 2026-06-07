import { describe, it, expect } from 'vitest';
import { handleUserPatch, handleUserChangePhone } from './users';

const O = 'https://admin.replaycon.in';

describe('handleUserPatch', () => {
  it('updates name/email/notes and writes audit', async () => {
    const audit: any = {};
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { phone: '9876543210', name: 'Old', email: null, notes: null }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876543210', name: 'New' }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/users/9876543210', { method: 'PATCH', body: JSON.stringify({ name: 'New' }) });
    const res = await handleUserPatch(req, {} as any, sb, '9876543210', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.action).toBe('user.update');
  });
});

describe('handleUserChangePhone', () => {
  it('rejects an invalid new phone', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://x/api/admin/users/0000000001/change-phone', { method: 'POST', body: JSON.stringify({ phone: '123' }) });
    const res = await handleUserChangePhone(req, {} as any, sb, '0000000001', 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('rejects when the new phone is taken', async () => {
    const sb: any = {
      from: () => ({
        select: () => ({ eq: (col: string, val: string) => ({ maybeSingle: async () => ({ data: val === '9999999999' ? { phone: '9999999999' } : { phone: '0000000001' }, error: null }) }) }),
      }),
    };
    const req = new Request('https://x/api/admin/users/0000000001/change-phone', { method: 'POST', body: JSON.stringify({ phone: '9999999999' }) });
    const res = await handleUserChangePhone(req, {} as any, sb, '0000000001', 'sid@x.com', O);
    expect(res.status).toBe(409);
  });

  it('changes the phone and writes audit', async () => {
    const audit: any = {};
    let updateArg: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: (col: string, val: string) => ({ maybeSingle: async () => ({ data: val === '0000000001' ? { phone: '0000000001' } : null, error: null }) }) }),
          update: (patch: any) => { updateArg = patch; return { eq: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876500000' }, error: null }) }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://x/api/admin/users/0000000001/change-phone', { method: 'POST', body: JSON.stringify({ phone: '9876500000' }) });
    const res = await handleUserChangePhone(req, {} as any, sb, '0000000001', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(updateArg).toEqual({ phone: '9876500000' });
    expect(audit.row.action).toBe('user.phone_change');
    expect(audit.row.diff.phone).toEqual({ old: '0000000001', new: '9876500000' });
  });
});
