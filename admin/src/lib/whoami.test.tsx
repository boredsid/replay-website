import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdmin } from './api';
import { WhoAmIProvider } from './whoami';

vi.mock('./api', () => ({ fetchAdmin: vi.fn() }));

describe('WhoAmIProvider connectivity handling', () => {
  let online = true;

  beforeEach(() => {
    online = true;
    vi.spyOn(Navigator.prototype, 'onLine', 'get').mockImplementation(() => online);
    vi.mocked(fetchAdmin).mockResolvedValue({ email: 'admin@replaycon.in' });
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps the verified admin session mounted if connectivity drops', async () => {
    render(
      <WhoAmIProvider fallback={<span>Loading</span>}>
        {(who) => <span>{who.email}</span>}
      </WhoAmIProvider>,
    );
    expect(await screen.findByText('admin@replaycon.in')).toBeInTheDocument();

    online = false;
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('admin@replaycon.in')).toBeInTheDocument();
  });

  it('shows a connection screen when the installed app starts offline', async () => {
    online = false;
    render(
      <WhoAmIProvider fallback={<span>Loading</span>}>
        {(who) => <span>{who.email}</span>}
      </WhoAmIProvider>,
    );
    expect(await screen.findByRole('heading', { name: /offline/i })).toBeInTheDocument();
    expect(fetchAdmin).not.toHaveBeenCalled();
  });
});
