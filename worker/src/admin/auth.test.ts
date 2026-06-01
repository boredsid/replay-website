import { describe, it, expect } from 'vitest';
import { pickAdminOrigin, adminCorsHeaders, adminJson } from './auth';

const env = (o = 'https://admin.replaycon.in') => ({ ADMIN_ORIGIN: o } as any);

describe('pickAdminOrigin', () => {
  it('echoes the request origin when it matches ADMIN_ORIGIN', () => {
    const req = new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'https://admin.replaycon.in' } });
    expect(pickAdminOrigin(req, env())).toBe('https://admin.replaycon.in');
  });
  it('allows localhost dev origin', () => {
    const req = new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'http://localhost:5173' } });
    expect(pickAdminOrigin(req, env())).toBe('http://localhost:5173');
  });
  it('falls back to ADMIN_ORIGIN for unknown origins', () => {
    const req = new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'https://evil.com' } });
    expect(pickAdminOrigin(req, env())).toBe('https://admin.replaycon.in');
  });
});

describe('adminCorsHeaders', () => {
  it('sets credentialed CORS headers', () => {
    const h = adminCorsHeaders('https://admin.replaycon.in');
    expect(h['Access-Control-Allow-Origin']).toBe('https://admin.replaycon.in');
    expect(h['Access-Control-Allow-Credentials']).toBe('true');
    expect(h['Access-Control-Allow-Methods']).toContain('PATCH');
  });
});

describe('adminJson', () => {
  it('returns json with credentialed CORS', async () => {
    const res = adminJson({ ok: true }, 200, 'https://admin.replaycon.in');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await res.json()).toEqual({ ok: true });
  });
});
