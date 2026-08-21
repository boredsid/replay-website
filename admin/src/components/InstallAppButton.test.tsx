import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InstallAppButton from './InstallAppButton';
import { initializePwaInstallPrompt } from '@/lib/pwa';

describe('InstallAppButton', () => {
  it('uses the browser install prompt when it is available', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt');
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });

    initializePwaInstallPrompt();
    window.dispatchEvent(event);
    render(<InstallAppButton />);
    const button = await screen.findByRole('button', { name: 'Install app' });
    fireEvent.click(button);

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument());
  });
});
