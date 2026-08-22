import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_AFTER_MS, isStale, useEventData } from './use-event-data';
import { fetchBootstrap } from './api';
import type { BootstrapData } from '../types';

vi.mock('./api', () => ({ fetchBootstrap: vi.fn() }));

const mockFetch = vi.mocked(fetchBootstrap);

function payload(generatedAt: string): BootstrapData {
  return {
    generated_at: generatedAt,
    timezone: 'Asia/Kolkata',
    edition: null,
    schedule: [],
    announcements: [],
  };
}

/** Drives the visibility API, which jsdom exposes as a plain property. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  mockFetch.mockReset();
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isStale', () => {
  it('is never stale before the first successful fetch', () => {
    expect(isStale(null, 10_000_000)).toBe(false);
  });

  it('turns stale only past the threshold', () => {
    expect(isStale(1_000, 1_000 + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(1_000, 1_000 + STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe('useEventData', () => {
  it('loads once on mount', async () => {
    mockFetch.mockResolvedValue(payload('first'));
    const { result } = renderHook(() => useEventData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.generated_at).toBe('first');
    expect(result.current.error).toBeNull();
    expect(result.current.fetchedAt).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches when the app is resumed from the background', async () => {
    mockFetch.mockResolvedValue(payload('first'));
    const { result } = renderHook(() => useEventData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValue(payload('second'));
    await act(async () => { setVisibility('visible'); });

    await waitFor(() => expect(result.current.data?.generated_at).toBe('second'));
  });

  it('does not refetch while the app is hidden', async () => {
    mockFetch.mockResolvedValue(payload('first'));
    const { result } = renderHook(() => useEventData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { setVisibility('hidden'); });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches when the connection comes back', async () => {
    mockFetch.mockResolvedValue(payload('first'));
    const { result } = renderHook(() => useEventData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockResolvedValue(payload('reconnected'));
    await act(async () => { window.dispatchEvent(new Event('online')); });

    await waitFor(() => expect(result.current.data?.generated_at).toBe('reconnected'));
  });

  it('keeps the last good payload when a refresh fails', async () => {
    mockFetch.mockResolvedValue(payload('good'));
    const { result } = renderHook(() => useEventData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockFetch.mockRejectedValue(new Error('request_failed'));
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.error).toBe('request_failed'));
    // Stale programme data beats an error page on a bad venue network.
    expect(result.current.data?.generated_at).toBe('good');
  });

  it('clears a previous error once a refresh succeeds', async () => {
    mockFetch.mockRejectedValue(new Error('request_failed'));
    const { result } = renderHook(() => useEventData());
    await waitFor(() => expect(result.current.error).toBe('request_failed'));

    mockFetch.mockResolvedValue(payload('recovered'));
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.data?.generated_at).toBe('recovered');
  });

  it('still resolves under StrictMode\'s mount/unmount/remount cycle', async () => {
    mockFetch.mockResolvedValue(payload('strict'));
    const { result } = renderHook(() => useEventData(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.generated_at).toBe('strict');
  });

  it('collapses overlapping triggers into a single request', async () => {
    let release: (value: BootstrapData) => void = () => {};
    mockFetch.mockReturnValue(new Promise<BootstrapData>((resolve) => { release = resolve; }));

    const { result } = renderHook(() => useEventData());
    // Resuming a phone commonly fires visibilitychange and online together.
    await act(async () => {
      setVisibility('visible');
      window.dispatchEvent(new Event('online'));
      result.current.refresh();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => { release(payload('once')); });
    await waitFor(() => expect(result.current.data?.generated_at).toBe('once'));
  });
});
