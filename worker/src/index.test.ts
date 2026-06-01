import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from './index';

const adminBaseEnv = {
  ENVIRONMENT: 'test',
  ADMIN_ORIGIN: 'https://admin.replaycon.in',
  CF_ACCESS_TEAM_DOMAIN: 'x',
  CF_ACCESS_AUD: 'y',
  ADMIN_EMAILS: 'a@x.com',
} as any;

describe("worker", () => {
  it("GET /api/health returns ok", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it("unknown path returns 404", async () => {
    const res = await SELF.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
  });
});

describe('admin gate', () => {
  it('rejects /api/admin/* without a token (401)', async () => {
    const res = await worker.fetch(new Request('https://api.x/api/admin/whoami', { headers: { Origin: 'https://admin.replaycon.in' } }), adminBaseEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('answers admin OPTIONS preflight with credentialed CORS', async () => {
    const res = await worker.fetch(new Request('https://api.x/api/admin/whoami', { method: 'OPTIONS', headers: { Origin: 'https://admin.replaycon.in' } }), adminBaseEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.replaycon.in');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});
