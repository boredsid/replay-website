import type { Env } from './index';

/**
 * Cloudflare-backed public API throttling. Bindings are optional so pure unit
 * tests and local scripts can call handlers without a Cloudflare runtime.
 */
export async function publicRequestAllowed(
  env: Env,
  req: Request,
  route: string,
  subject: string,
): Promise<boolean> {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const checks: Array<Promise<{ success: boolean }>> = [];

  if (env.PUBLIC_RATE_LIMITER) {
    checks.push(env.PUBLIC_RATE_LIMITER.limit({ key: `${route}:ip:${ip}` }));
  }
  if (env.SUBJECT_RATE_LIMITER) {
    checks.push(env.SUBJECT_RATE_LIMITER.limit({ key: `${route}:subject:${subject}` }));
  }

  if (checks.length === 0) return true;
  const results = await Promise.all(checks);
  return results.every((result) => result.success);
}
