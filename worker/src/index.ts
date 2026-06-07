// worker/src/index.ts
import { jsonResponse, CORS_HEADERS } from './validation';
import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEditionSpots } from './edition-spots';
import { handleCancelRegistration } from './cancel-registration';
import { handleLead } from './lead';
import { handleIcsRequest } from './ics';
import { verifyAccessJwt } from './access-auth';
import { pickAdminOrigin, adminCorsHeaders, adminJson } from './admin/auth';
import { serviceClient } from './supabase';
import { handleWhoami } from './admin/whoami';
import { handleRebuild } from './admin/rebuild';
import { handleDashboard } from './admin/dashboard';
import { handleRegList, handleRegGet, handleRegCreate, handleRegPatch } from './admin/registrations';
import { handleEdList, handleEdCreate, handleEdPatch } from './admin/editions';
import { handleUserList, handleUserGet, handleUserPatch, handleUserChangePhone } from './admin/users';
import { handleLeadsList } from './admin/leads';
import { handleAuditList } from './admin/audit';

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
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      if (path.startsWith('/api/admin/')) {
        return new Response(null, { status: 204, headers: adminCorsHeaders(pickAdminOrigin(req, env)) });
      }
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (path.startsWith('/api/admin/')) {
        const origin = pickAdminOrigin(req, env);
        const token = req.headers.get('Cf-Access-Jwt-Assertion') || '';
        const auth = await verifyAccessJwt(token, env);
        if (!auth.ok) return adminJson({ error: 'unauthorized', reason: auth.reason }, 401, origin);
        const email = auth.email;
        const sb = serviceClient(env);

        if (path === '/api/admin/whoami' && req.method === 'GET') return handleWhoami(email, origin);
        if (path === '/api/admin/rebuild' && req.method === 'POST') return await handleRebuild(env, sb, email, origin);
        if (path === '/api/admin/dashboard' && req.method === 'GET') return await handleDashboard(req, env, sb, origin);
        if (path === '/api/admin/leads' && req.method === 'GET') return await handleLeadsList(req, env, sb, origin);
        if (path === '/api/admin/audit' && req.method === 'GET') return await handleAuditList(req, env, sb, origin);

        if (path === '/api/admin/registrations' && req.method === 'GET') return await handleRegList(req, env, sb, origin);
        if (path === '/api/admin/registrations' && req.method === 'POST') return await handleRegCreate(req, env, sb, email, origin);
        const regMatch = path.match(/^\/api\/admin\/registrations\/([^/]+)$/);
        if (regMatch && req.method === 'GET') return await handleRegGet(env, sb, regMatch[1], origin);
        if (regMatch && req.method === 'PATCH') return await handleRegPatch(req, env, sb, regMatch[1], email, origin);

        if (path === '/api/admin/editions' && req.method === 'GET') return await handleEdList(env, sb, origin);
        if (path === '/api/admin/editions' && req.method === 'POST') return await handleEdCreate(req, env, sb, email, origin);
        const edMatch = path.match(/^\/api\/admin\/editions\/([^/]+)$/);
        if (edMatch && req.method === 'PATCH') return await handleEdPatch(req, env, sb, edMatch[1], email, origin);

        if (path === '/api/admin/users' && req.method === 'GET') return await handleUserList(req, env, sb, origin);
        const userChangePhone = path.match(/^\/api\/admin\/users\/([^/]+)\/change-phone$/);
        if (userChangePhone && req.method === 'POST') return await handleUserChangePhone(req, env, sb, userChangePhone[1], email, origin);
        const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userMatch && req.method === 'GET') return await handleUserGet(env, sb, userMatch[1], origin);
        if (userMatch && req.method === 'PATCH') return await handleUserPatch(req, env, sb, userMatch[1], email, origin);

        return adminJson({ error: 'not_found' }, 404, origin);
      }

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
