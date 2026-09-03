import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import QrScanner from './QrScanner';

vi.mock('jsqr', () => ({ default: () => null }));

function setCamera(impl: (() => Promise<MediaStream>) | null) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: impl ? { getUserMedia: impl } : undefined,
  });
}

beforeEach(() => { setCamera(null); });
afterEach(() => { vi.restoreAllMocks(); });

describe('reading a pass', () => {
  it('falls back to typing when the browser has no camera at all', async () => {
    render(<QrScanner onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    // Manual entry is the other half of the tool, not a degraded mode: a dead
    // battery or a denied permission both end here.
    expect(await screen.findByText(/cannot use the camera/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Pass code')).toBeInTheDocument();
  });

  it('falls back to typing when permission is refused', async () => {
    setCamera(() => Promise.reject(new Error('NotAllowedError')));
    render(<QrScanner onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    expect(await screen.findByText(/No camera access/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Pass code')).toBeInTheDocument();
  });

  it('passes a typed code up, trimmed', async () => {
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} />);
    await userEvent.click(screen.getByRole('button', { name: /Type the code/ }));
    await userEvent.type(screen.getByLabelText('Pass code'), '  ABCD1234EFGH5678  ');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));

    expect(onScan).toHaveBeenCalledWith('ABCD1234EFGH5678');
  });

  it('will not submit an empty code', async () => {
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} />);
    await userEvent.click(screen.getByRole('button', { name: /Type the code/ }));
    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
    expect(onScan).not.toHaveBeenCalled();
  });

  it('clears the field after a lookup so the next person starts clean', async () => {
    render(<QrScanner onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Type the code/ }));
    const field = screen.getByLabelText('Pass code');
    await userEvent.type(field, 'ABCD1234EFGH5678');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(field).toHaveValue('');
  });
});
