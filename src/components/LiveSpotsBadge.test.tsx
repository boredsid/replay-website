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
  it('shows loading initially then renders combined remaining spots', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 60, sold_out: false }, day2: { capacity: 250, remaining: 40, sold_out: false }, both_sold_out: false });
    render(<LiveSpotsBadge editionId="e1" day1Label="Saturday" day2Label="Sunday" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    // 60 + 40 = 100 remaining out of 500 total
    await waitFor(() => expect(screen.getByText(/100 of 500/)).toBeInTheDocument());
  });

  it('renders nothing while under half of capacity is used', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 200, sold_out: false }, day2: { capacity: 250, remaining: 200, sold_out: false }, both_sold_out: false });
    const { container } = render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders once exactly half of capacity is used', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 125, sold_out: false }, day2: { capacity: 250, remaining: 125, sold_out: false }, both_sold_out: false });
    render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(screen.getByText(/250 of 500/)).toBeInTheDocument());
  });

  it('reveals its wrapper only past the threshold', async () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'availability-section';
    wrapper.hidden = true;
    document.body.appendChild(wrapper);

    mockFetch(200, { day1: { capacity: 250, remaining: 200, sold_out: false }, day2: { capacity: 250, remaining: 200, sold_out: false }, both_sold_out: false });
    const quiet = render(<LiveSpotsBadge editionId="e1" revealTargetId="availability-section" />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
    expect(wrapper.hidden).toBe(true);
    quiet.unmount();

    mockFetch(200, { day1: { capacity: 250, remaining: 20, sold_out: false }, day2: { capacity: 250, remaining: 20, sold_out: false }, both_sold_out: false });
    render(<LiveSpotsBadge editionId="e1" revealTargetId="availability-section" />);
    await waitFor(() => expect(wrapper.hidden).toBe(false));

    wrapper.remove();
  });

  it('renders "Event full" when both days are sold out', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 0, sold_out: true }, day2: { capacity: 250, remaining: 0, sold_out: true }, both_sold_out: true });
    render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(screen.getByText(/event full/i)).toBeInTheDocument());
  });

  it('renders per-day note when only one day is sold out', async () => {
    mockFetch(200, { day1: { capacity: 250, remaining: 0, sold_out: true }, day2: { capacity: 250, remaining: 100, sold_out: false }, both_sold_out: false });
    render(<LiveSpotsBadge editionId="e1" day1Label="Saturday" day2Label="Sunday" />);
    await waitFor(() => expect(screen.getByText(/saturday full.*100 sunday spots left/i)).toBeInTheDocument());
  });

  it('shows a clear status on fetch failure', async () => {
    mockFetch(500, {});
    render(<LiveSpotsBadge editionId="e1" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/temporarily unavailable/i));
  });
});
