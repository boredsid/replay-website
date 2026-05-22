import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LiveSpotsBadge } from './LiveSpotsBadge';

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.spyOn(global, 'fetch');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  (global.fetch as any).mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('LiveSpotsBadge', () => {
  it('shows loading initially then renders remaining spots', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 248, sold_out: false }, day2: { capacity: 250, remaining: 245, sold_out: false }, both_sold_out: false });
    render(<LiveSpotsBadge editionId="e1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/248/)).toBeInTheDocument());
    expect(screen.getByText(/245/)).toBeInTheDocument();
  });

  it('renders sold-out message when both days are sold out', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 0, sold_out: true }, day2: { capacity: 250, remaining: 0, sold_out: true }, both_sold_out: true });
    render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(screen.getByText(/sold out/i)).toBeInTheDocument());
  });

  it('quietly renders nothing on fetch failure', async () => {
    mockFetch(500, {});
    const { container } = render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(container.textContent).not.toMatch(/loading/i));
    expect(container.textContent?.trim()).toBe('');
  });
});
