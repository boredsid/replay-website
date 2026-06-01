// worker/src/index.ts
import { jsonResponse, CORS_HEADERS } from './validation';
import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEditionSpots } from './edition-spots';
import { handleCancelRegistration } from './cancel-registration';
import { handleLead } from './lead';
import { handleIcsRequest } from './ics';

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
  ADMIN_ORIGIN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === '/api/health') {
        return jsonResponse({ ok: true, env: env.ENVIRONMENT });
      }
      if (path === '/api/lookup-phone' && req.method === 'POST') {
        return await handleLookupPhone(req, env);
      }
      if (path === '/api/register' && req.method === 'POST') {
        return await handleRegister(req, env);
      }
      if (path.startsWith('/api/edition-spots/') && req.method === 'GET') {
        const editionId = path.split('/api/edition-spots/')[1];
        return await handleEditionSpots(editionId, env);
      }
      if (path === '/api/cancel-registration' && req.method === 'POST') {
        return await handleCancelRegistration(req, env);
      }
      if (path === '/api/lead' && req.method === 'POST') {
        return await handleLead(req, env);
      }
      if (path.startsWith('/api/ics/') && path.endsWith('.ics') && req.method === 'GET') {
        return await handleIcsRequest(req, env);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('worker_error', err);
      return jsonResponse({ error: 'internal' }, 500);
    }
  },
};
