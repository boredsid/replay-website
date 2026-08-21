import type { BootstrapData } from '../types';

const configuredBase = (import.meta.env.VITE_WORKER_URL as string | undefined)?.trim();
const API_BASE = (configuredBase || 'https://api.replaycon.in').replace(/\/$/, '');

export async function fetchBootstrap(signal?: AbortSignal): Promise<BootstrapData> {
  const response = await fetch(`${API_BASE}/api/app/bootstrap`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
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
