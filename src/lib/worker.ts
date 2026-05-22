// src/lib/worker.ts
import type {
  ApiLookupPhoneResponse,
  ApiEditionSpotsResponse,
  ApiRegisterRequest,
  ApiRegisterResponse,
  StepReached,
} from './types';

function base(): string {
  const url = import.meta.env.PUBLIC_WORKER_URL;
  if (!url) throw new Error('PUBLIC_WORKER_URL not set');
  return url;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(`worker ${path} returned ${res.status}`);
    (err as any).status = res.status;
    (err as any).body = errBody;
    throw err;
  }
  return (await res.json()) as T;
}

export async function lookupPhone(phone: string, editionId: string): Promise<ApiLookupPhoneResponse> {
  return jsonPost<ApiLookupPhoneResponse>('/api/lookup-phone', { phone, edition_id: editionId });
}

export async function getEditionSpots(editionId: string): Promise<ApiEditionSpotsResponse> {
  const res = await fetch(`${base()}/api/edition-spots/${editionId}`);
  if (!res.ok) {
    const err = new Error(`worker /api/edition-spots returned ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  return (await res.json()) as ApiEditionSpotsResponse;
}

export async function registerForEdition(input: ApiRegisterRequest): Promise<ApiRegisterResponse> {
  return jsonPost<ApiRegisterResponse>('/api/register', input);
}

export async function cancelRegistration(registrationId: string, phone: string): Promise<{ ok: true; registration_id: string }> {
  return jsonPost('/api/cancel-registration', { registration_id: registrationId, phone });
}

/** Fire-and-forget. Resolves to `{ok:true}` on success, `undefined` on any error. */
export async function captureLead(
  phone: string,
  editionId: string,
  stepReached: StepReached,
  name?: string,
): Promise<{ ok: true } | undefined> {
  try {
    const res = await fetch(`${base()}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, edition_id: editionId, step_reached: stepReached, name }),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as { ok: true };
  } catch {
    return undefined;
  }
}
