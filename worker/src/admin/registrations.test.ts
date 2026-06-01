import { describe, it, expect, vi } from 'vitest';
vi.mock('../editions', () => ({
  getEditionBySlug: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', venue: 'V', start_date: '2026-09-12', end_date: '2026-09-13', capacity_per_day: { day1: 250, day2: 250 } })),
  getCurrentEdition: vi.fn(async () => ({ id: 'e1', slug: 'replay-3', venue: 'V', start_date: '2026-09-12', end_date: '2026-09-13', capacity_per_day: { day1: 250, day2: 250 } })),
}));
vi.mock('../registration-email', () => ({ sendRegistrationConfirmation: vi.fn(async () => {}) }));
import { handleRegPatch, handleRegCreate } from './registrations';

const O = 'https://admin.replaycon.in';

describe('handleRegPatch', () => {
  it('updates payment_status and writes an audit diff', async () => {
    const audit: any = {};
    const sb: any = {
      from: (t: string) => {
        if (t === 'registrations') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'r1', payment_status: 'pending', amount_paid: 800 }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'r1', payment_status: 'confirmed', amount_paid: 800 }, error: null }) }) }) }),
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://api.x/api/admin/registrations/r1', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'r1', 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(audit.row.action).toBe('registration.update');
    expect(audit.row.diff.payment_status).toEqual({ old: 'pending', new: 'confirmed' });
  });

  it('returns 404 when registration missing', async () => {
    const sb: any = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const req = new Request('https://api.x/api/admin/registrations/rX', { method: 'PATCH', body: JSON.stringify({ payment_status: 'confirmed' }) });
    const res = await handleRegPatch(req, {} as any, sb, 'rX', 'sid@x.com', O);
    expect(res.status).toBe(404);
  });
});

describe('handleRegCreate', () => {
  it('rejects invalid phone', async () => {
    const sb: any = { from: () => ({}) };
    const req = new Request('https://api.x/api/admin/registrations', { method: 'POST', body: JSON.stringify({ phone: '12', pass_type: 'oneshot', days: ['day1'] }) });
    const res = await handleRegCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(400);
  });

  it('creates a registration, upserts user, writes audit', async () => {
    const audit: any = {};
    let insertedReg: any = null;
    const sb: any = {
      from: (t: string) => {
        if (t === 'users') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { phone: '9876543210' }, error: null }) }) }),
        };
        if (t === 'registrations') return {
          insert: (row: any) => { insertedReg = row; return { select: () => ({ single: async () => ({ data: { id: 'r9', ...row }, error: null }) }) }; },
        };
        if (t === 'admin_audit_log') return { insert: async (row: any) => { audit.row = row; return { error: null }; } };
        return {} as any;
      },
    };
    const req = new Request('https://api.x/api/admin/registrations', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', name: 'Asha', pass_type: 'oneshot', days: ['day1'], amount_paid: 800, payment_status: 'confirmed', send_email: false }),
    });
    const res = await handleRegCreate(req, {} as any, sb, 'sid@x.com', O);
    expect(res.status).toBe(200);
    expect(insertedReg.source).toEqual({ manual: true, by: 'sid@x.com' });
    expect(audit.row.action).toBe('registration.create');
  });
});
