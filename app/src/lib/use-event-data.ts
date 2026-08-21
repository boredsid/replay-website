import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBootstrap } from './api';
import type { BootstrapData } from '../types';

/**
 * How often a visible app re-checks for programme and announcement changes.
 *
 * The bootstrap endpoint is `max-age=60`, so anything under a minute is served
 * from cache anyway. 90s keeps an urgent notice under two minutes old without
 * making the venue network carry pointless traffic.
 */
export const REFRESH_INTERVAL_MS = 90_000;

/** Beyond this the on-screen payload is old enough to say so. */
export const STALE_AFTER_MS = 10 * 60_000;

const REQUEST_TIMEOUT_MS = 12_000;

export interface EventDataState {
  data: BootstrapData | null;
  error: string | null;
  /** First load only — there is nothing on screen yet. */
  loading: boolean;
  /** A refetch is in flight while usable data stays on screen. */
  refreshing: boolean;
  /** Epoch ms of the last successful fetch, or null before one succeeds. */
  fetchedAt: number | null;
  refresh: () => void;
}

export function isStale(fetchedAt: number | null, now: number): boolean {
  if (fetchedAt === null) return false;
  return now - fetchedAt > STALE_AFTER_MS;
}

/**
 * Owns the bootstrap payload and keeps it current.
 *
 * An event-day app that fetches once on mount is the same as an app with no
 * announcements: an installed PWA is resumed from the background far more often
 * than it is cold-started, so without these triggers an urgent notice never
 * reaches anyone who already had the app open. We refetch on resume, on
 * reconnect, and on an interval while visible.
 */
export function useEventData(): EventDataState {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // Guards against overlapping requests when several triggers fire together —
  // resuming a backgrounded phone commonly fires `visibilitychange` and
  // `online` within the same tick.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const hasData = useRef(false);

  // Re-arm on every mount. StrictMode mounts, tears down, and remounts in
  // development, so a ref that is only ever set to false would leave the app
  // permanently stuck on its loading state after the simulated remount.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (hasData.current) setRefreshing(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const next = await fetchBootstrap(controller.signal);
      if (!mounted.current) return;
      hasData.current = true;
      setData(next);
      setFetchedAt(Date.now());
      setError(null);
    } catch (loadError) {
      if (!mounted.current) return;
      // A failed refresh must never blank a screen that is already useful —
      // stale programme data beats an error page in a venue with bad signal.
      setError(loadError instanceof Error ? loadError.message : 'request_failed');
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const onOnline = () => { void load(); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [load]);

  const refresh = useCallback(() => { void load(); }, [load]);

  return { data, error, loading, refreshing, fetchedAt, refresh };
}
