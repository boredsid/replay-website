import { emitRevalidate } from './revalidate';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function fetchAdmin<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.method && init.method !== 'GET' && typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError(0, "You're offline. Connect to save.");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    location.reload();
    throw new ApiError(401, 'Unauthorized');
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body && typeof (body as Record<string, unknown>).error === 'string'
        ? ((body as Record<string, string>).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  if (init?.method && init.method !== 'GET') emitRevalidate();

  return body as T;
}

export function showApiError(err: unknown, fallback = 'Something went wrong, try again.') {
  import('sonner').then(({ toast }) => {
    if (err instanceof ApiError) {
      toast.error(err.message);
    } else {
      toast.error(fallback);
    }
  });
}
