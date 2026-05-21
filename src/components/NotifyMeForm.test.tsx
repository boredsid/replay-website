import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyMeForm } from './NotifyMeForm';

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.spyOn(global, 'fetch');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('NotifyMeForm', () => {
  it('renders status-specific copy', () => {
    render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="upcoming" />);
    expect(screen.getByText(/opens soon/i)).toBeInTheDocument();
  });

  it('rejects submit with invalid phone', async () => {
    const user = userEvent.setup();
    render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="upcoming" />);
    await user.type(screen.getByLabelText(/phone/i), '12');
    await user.click(screen.getByRole('button', { name: /notify/i }));
    expect(screen.getByText(/enter a 10-digit phone/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /api/lead and shows thanks on submit', async () => {
    const user = userEvent.setup();
    (global.fetch as any).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="upcoming" />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /notify/i }));
    await waitFor(() => expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lead'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"phone":"9876543210"'),
      }),
    );
  });

  it('shows different copy for sold_out and closed', () => {
    const { rerender } = render(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="sold_out" />);
    expect(screen.getByText(/sold out/i)).toBeInTheDocument();
    rerender(<NotifyMeForm editionId="e1" editionName="REPLAY 3" status="closed" />);
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
  });
});
