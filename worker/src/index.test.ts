import { SELF } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";

vi.mock('./supabase', () => ({
  serviceClient: vi.fn(() => ({ marker: 'mock-service-client' })),
}));

vi.mock('./app-bootstrap', () => ({
  handleAppBootstrap: vi.fn(async () => new Response(JSON.stringify({ edition: null, schedule: [], announcements: [] }), {
    headers: { 'Content-Type': 'application/json' },
  })),
}));

import worker from './index';
import { handleAppBootstrap } from './app-bootstrap';

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

  it('routes the public attendee bootstrap endpoint', async () => {
    const res = await worker.fetch(new Request('https://api.x/api/app/bootstrap'), adminBaseEnv);
    expect(res.status).toBe(200);
    expect(handleAppBootstrap).toHaveBeenCalledWith({ marker: 'mock-service-client' });
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
