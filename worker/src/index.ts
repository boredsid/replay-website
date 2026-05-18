// worker/src/index.ts

export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  APPS_SCRIPT_URL: string;
  APPS_SCRIPT_SECRET: string;
  REPLAY_SITE_URL: string;
  BGC_WORKER_URL: string;
  REPLAY_TO_BGC_SECRET: string;
  UPI_ID: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  CLOUDFLARE_PAGES_DEPLOY_HOOK: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cf-Access-Jwt-Assertion",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return json({ ok: true, env: env.ENVIRONMENT });
    }

    return json({ error: "Not found" }, 404);
  },
};
