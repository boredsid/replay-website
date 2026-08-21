import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  afterEach(() => vi.restoreAllMocks());

  it('appears offline and clears when connectivity returns', () => {
    let online = false;
    vi.spyOn(Navigator.prototype, 'onLine', 'get').mockImplementation(() => online);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/reconnect to load or save/i);

    online = true;
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
