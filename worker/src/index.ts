// worker/src/index.ts
import { jsonResponse, CORS_HEADERS } from './validation';
import { handleLookupPhone } from './lookup-phone';
import { handleRegister, handleRegisterPreview } from './register';
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
import { handleScheduleList, handleScheduleGet, handleScheduleCreate, handleSchedulePatch } from './admin/schedule';
import { handleAppBootstrap } from './app-bootstrap';
import { handleAnnouncementList, handleAnnouncementGet, handleAnnouncementCreate, handleAnnouncementPatch } from './admin/announcements';
import { handleCheckInSearch, handleCheckIn, handleCheckInBulk, handleCheckInUndo, handleAttendeePatch, handleCheckInRoster } from './admin/check-in';
import { handlePairingCodeIssue, handleScan } from './admin/pairing';
import { handleSessionRoster, handleSessionSignupCreate, handleSessionSignupRemove, handleSessionAttendeeSearch } from './admin/session-roster';
import { handleAppPair } from './app-pair';
import { handleMySignups, handleSignUp, handleCancelSignup } from './app-signups';
import { handlePartnerPurchase, handlePartnerPurchasePreview } from './partner-purchase';
import { handlePromoPreview } from './promo-preview';
import {
  handlePromoList,
  handlePromoGet,
  handlePromoCreate,
  handlePromoPatch,
  handlePromoDelete,
  handlePromoValidate,
} from './admin/promo-codes';
import { handlePassStatus } from './pass-status';
import { handlePartnerList, handlePartnerGet, handlePartnerCreate, handlePartnerPatch, handlePartnerDelete, handlePartnerInviteCreate } from './admin/partners';
import { handlePartnerInviteGet, handlePartnerInvitePaymentClaimed, handlePartnerInviteSubmit } from './partner-invite';
import {
  handleSponsorList,
  handleSponsorGet,
  handleSponsorCreate,
  handleSponsorPatch,
  handleSponsorDelete,
  handleSponsorLogoUpload,
} from './admin/sponsors';

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
  PUBLIC_RATE_LIMITER?: RateLimit;
  SUBJECT_RATE_LIMITER?: RateLimit;
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

        // Matched before the `/check-in` prefix patterns so the more specific
        // paths are not swallowed by the bare one.
        if (path === '/api/admin/check-in/search' && req.method === 'GET') return await handleCheckInSearch(req, env, sb, origin);
        if (path === '/api/admin/check-in/roster' && req.method === 'GET') return await handleCheckInRoster(req, env, sb, origin);
        if (path === '/api/admin/check-in/pairing-code' && req.method === 'POST') return await handlePairingCodeIssue(req, env, sb, email, origin);
        if (path === '/api/admin/scan' && req.method === 'POST') return await handleScan(req, env, sb, origin);

        // Matched before the `/sessions/:id` patterns so the search is not
        // treated as a session id.
        if (path === '/api/admin/sessions/attendees' && req.method === 'GET') return await handleSessionAttendeeSearch(req, env, sb, origin);
        const rosterMatch = path.match(/^\/api\/admin\/sessions\/([^/]+)\/roster$/);
        if (rosterMatch && req.method === 'GET') return await handleSessionRoster(req, sb, rosterMatch[1], origin);
        const sessionSignupMatch = path.match(/^\/api\/admin\/sessions\/([^/]+)\/signups$/);
        if (sessionSignupMatch && req.method === 'POST') return await handleSessionSignupCreate(req, sb, sessionSignupMatch[1], email, origin);
        if (sessionSignupMatch && req.method === 'DELETE') return await handleSessionSignupRemove(req, sb, sessionSignupMatch[1], email, origin);
        if (path === '/api/admin/check-in/bulk' && req.method === 'POST') return await handleCheckInBulk(req, sb, email, origin);
        if (path === '/api/admin/check-in/undo' && req.method === 'POST') return await handleCheckInUndo(req, sb, email, origin);
        if (path === '/api/admin/check-in' && req.method === 'POST') return await handleCheckIn(req, sb, email, origin);
        const attendeeMatch = path.match(/^\/api\/admin\/attendees\/([^/]+)$/);
        if (attendeeMatch && req.method === 'PATCH') return await handleAttendeePatch(req, sb, attendeeMatch[1], email, origin);

        if (path === '/api/admin/announcements' && req.method === 'GET') return await handleAnnouncementList(req, sb, origin);
        if (path === '/api/admin/announcements' && req.method === 'POST') return await handleAnnouncementCreate(req, sb, email, origin);
        const announcementMatch = path.match(/^\/api\/admin\/announcements\/([^/]+)$/);
        if (announcementMatch && req.method === 'GET') return await handleAnnouncementGet(sb, announcementMatch[1], origin);
        if (announcementMatch && req.method === 'PATCH') return await handleAnnouncementPatch(req, sb, announcementMatch[1], email, origin);

        // Matched before the `/promo-codes/:id` pattern that would swallow it.
        if (path === '/api/admin/promo-codes/validate' && req.method === 'POST') return await handlePromoValidate(req, sb, origin);
        if (path === '/api/admin/promo-codes' && req.method === 'GET') return await handlePromoList(req, sb, origin);
        if (path === '/api/admin/promo-codes' && req.method === 'POST') return await handlePromoCreate(req, sb, email, origin);
        const promoMatch = path.match(/^\/api\/admin\/promo-codes\/([^/]+)$/);
        if (promoMatch && req.method === 'GET') return await handlePromoGet(sb, promoMatch[1], origin);
        if (promoMatch && req.method === 'PATCH') return await handlePromoPatch(req, sb, promoMatch[1], email, origin);
        if (promoMatch && req.method === 'DELETE') return await handlePromoDelete(sb, promoMatch[1], email, origin);

        if (path === '/api/admin/partners' && req.method === 'GET') return await handlePartnerList(req, env, sb, origin);
        if (path === '/api/admin/partners' && req.method === 'POST') return await handlePartnerCreate(req, env, sb, email, origin);
        if (path === '/api/admin/partners/invites' && req.method === 'POST') return await handlePartnerInviteCreate(req, env, sb, email, origin);
        const partnerMatch = path.match(/^\/api\/admin\/partners\/([^/]+)$/);
        if (partnerMatch && req.method === 'GET') return await handlePartnerGet(env, sb, partnerMatch[1], origin);
        if (partnerMatch && req.method === 'PATCH') return await handlePartnerPatch(req, env, sb, partnerMatch[1], email, origin);
        if (partnerMatch && req.method === 'DELETE') return await handlePartnerDelete(sb, partnerMatch[1], email, origin);

        // The logo body is raw image bytes, so this route is matched before the
        // `/sponsors/:id` pattern that would otherwise swallow it.
        if (path === '/api/admin/sponsors/logo' && req.method === 'POST') return await handleSponsorLogoUpload(req, sb, email, origin);
        if (path === '/api/admin/sponsors' && req.method === 'GET') return await handleSponsorList(req, sb, origin);
        if (path === '/api/admin/sponsors' && req.method === 'POST') return await handleSponsorCreate(req, sb, email, origin);
        const sponsorMatch = path.match(/^\/api\/admin\/sponsors\/([^/]+)$/);
        if (sponsorMatch && req.method === 'GET') return await handleSponsorGet(sb, sponsorMatch[1], origin);
        if (sponsorMatch && req.method === 'PATCH') return await handleSponsorPatch(req, sb, sponsorMatch[1], email, origin);
        if (sponsorMatch && req.method === 'DELETE') return await handleSponsorDelete(sb, sponsorMatch[1], email, origin);

        if (path === '/api/admin/schedule' && req.method === 'GET') return await handleScheduleList(req, sb, origin);
        if (path === '/api/admin/schedule' && req.method === 'POST') return await handleScheduleCreate(req, sb, email, origin);
        const scheduleMatch = path.match(/^\/api\/admin\/schedule\/([^/]+)$/);
        if (scheduleMatch && req.method === 'GET') return await handleScheduleGet(sb, scheduleMatch[1], origin);
        if (scheduleMatch && req.method === 'PATCH') return await handleSchedulePatch(req, sb, scheduleMatch[1], email, origin);

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
      if (path === '/api/app/pair' && req.method === 'POST') {
        return await handleAppPair(req, env);
      }
      if (path === '/api/app/me/signups' && req.method === 'GET') {
        return await handleMySignups(req, env);
      }
      if (path === '/api/app/signups' && req.method === 'POST') {
        return await handleSignUp(req, env);
      }
      const signupMatch = path.match(/^\/api\/app\/signups\/([^/]+)$/);
      if (signupMatch && req.method === 'DELETE') {
        return await handleCancelSignup(req, env, signupMatch[1]);
      }
      if (path === '/api/app/bootstrap' && req.method === 'GET') {
        return await handleAppBootstrap(serviceClient(env));
      }
      if (path === '/api/pass-status' && req.method === 'POST') {
        return await handlePassStatus(req, env);
      }
      if (path === '/api/lookup-phone' && req.method === 'POST') {
        return await handleLookupPhone(req, env);
      }
      if (path === '/api/register' && req.method === 'POST') {
        return await handleRegister(req, env);
      }
      if (path === '/api/register/preview' && req.method === 'POST') {
        return await handleRegisterPreview(req, env);
      }
      if (path === '/api/promo/preview' && req.method === 'POST') {
        return await handlePromoPreview(req, env);
      }
      if (path === '/api/partner-purchase' && req.method === 'POST') {
        return await handlePartnerPurchase(req, env);
      }
      if (path === '/api/partner-purchase/preview' && req.method === 'POST') {
        return await handlePartnerPurchasePreview(req, env);
      }
      const inviteClaim = path.match(/^\/api\/partner-invite\/([^/]+)\/payment-claimed$/);
      if (inviteClaim && req.method === 'POST') {
        return await handlePartnerInvitePaymentClaimed(req, env, inviteClaim[1]);
      }
      const inviteMatch = path.match(/^\/api\/partner-invite\/([^/]+)$/);
      if (inviteMatch && req.method === 'GET') {
        return await handlePartnerInviteGet(req, env, inviteMatch[1]);
      }
      if (inviteMatch && req.method === 'POST') {
        return await handlePartnerInviteSubmit(req, env, inviteMatch[1]);
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
