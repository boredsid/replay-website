import type { BootstrapData } from '../types';

const configuredBase = (import.meta.env.VITE_WORKER_URL as string | undefined)?.trim();
const API_BASE = (configuredBase || 'https://api.replaycon.in').replace(/\/$/, '');

export async function fetchBootstrap(signal?: AbortSignal): Promise<BootstrapData> {
  const response = await fetch(`${API_BASE}/api/app/bootstrap`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    // The endpoint is `max-age=60, stale-while-revalidate=300`, so without this
    // a poll can be answered from the HTTP cache with a payload up to ~6 minutes
    // old. That is tolerable for the programme and not tolerable for an incident
    // notice. `no-cache` revalidates every time but still stores the result, and
    // offline is unaffected because the service worker keeps its own copy in
    // Cache Storage.
    cache: 'no-cache',
    signal,
  });
  if (!response.ok) throw new Error(response.status === 503 ? 'event_unavailable' : 'request_failed');
  const data = await response.json() as BootstrapData;
  if (!data || !Array.isArray(data.schedule) || typeof data.generated_at !== 'string') {
    throw new Error('invalid_event_payload');
  }
  return {
    ...data,
    // This keeps a staged app deploy compatible with the Phase 1 Worker while
    // the announcements migration and Worker release are rolling out.
    announcements: Array.isArray(data.announcements) ? data.announcements : [],
  };
}
