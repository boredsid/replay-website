import type { Env } from '../index';

const ALLOWED_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4321'];

export function pickAdminOrigin(req: Request, env: Env): string {
  const origin = req.headers.get('Origin') || '';
  if (origin === env.ADMIN_ORIGIN) return origin;
  if (ALLOWED_DEV_ORIGINS.includes(origin)) return origin;
  return env.ADMIN_ORIGIN;
}

export function adminCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function adminJson(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...adminCorsHeaders(origin) },
  });
}
