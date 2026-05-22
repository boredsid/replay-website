import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  it('renders a phone input and notify button', () => {
    render(<NotifyMeForm editionId="e1" editionName="REPLAY" status="upcoming" />);
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notify/i })).toBeInTheDocument();
  });

  it('rejects submit with invalid phone', async () => {
    const user = userEvent.setup();
    render(<NotifyMeForm editionId="e1" editionName="REPLAY" status="upcoming" />);
    await user.type(screen.getByLabelText(/phone/i), '12');
    await user.click(screen.getByRole('button', { name: /notify/i }));
    expect(screen.getByText(/enter a 10-digit phone/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /api/lead and shows thanks on submit', async () => {
    const user = userEvent.setup();
    (global.fetch as any).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<NotifyMeForm editionId="e1" editionName="REPLAY" status="upcoming" />);
    await user.type(screen.getByLabelText(/phone/i), '9876543210');
    await user.click(screen.getByRole('button', { name: /notify/i }));
    await waitFor(() => expect(screen.getByText(/got it/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lead'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"phone":"9876543210"'),
      }),
    );
  });

  it('renders the same form regardless of status (heading lives on the page wrapper)', () => {
    const { rerender } = render(<NotifyMeForm editionId="e1" editionName="REPLAY" status="sold_out" />);
    expect(screen.getByRole('button', { name: /notify/i })).toBeInTheDocument();
    rerender(<NotifyMeForm editionId="e1" editionName="REPLAY" status="closed" />);
    expect(screen.getByRole('button', { name: /notify/i })).toBeInTheDocument();
  });
});
