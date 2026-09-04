import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import QrScanner, { preferredCamera, looksLikePassCode } from './QrScanner';

vi.mock('jsqr', () => ({ default: () => null }));

/** Pretends to be a phone (coarse pointer + touch) or a laptop. */
function setPointer(kind: 'touch' | 'mouse') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('pointer: coarse') && kind === 'touch',
      media: query, addEventListener() {}, removeEventListener() {},
    }),
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: kind === 'touch' ? 5 : 0,
  });
}

function setCamera(impl: ((c?: MediaStreamConstraints) => Promise<MediaStream>) | null) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: impl ? { getUserMedia: impl } : undefined,
  });
}

beforeEach(() => { setCamera(null); setPointer('mouse'); });
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

  it('refuses a name instead of posting it as a pass code', async () => {
    // This is what people actually did: the camera failed, "Type the code" was
    // the only box on screen, and a name came back as "unknown pass" — which
    // reads as a broken pass rather than as the wrong box.
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} />);
    await userEvent.click(screen.getByRole('button', { name: /Type the code/ }));
    await userEvent.type(screen.getByLabelText('Pass code'), 'Siddhant Narula');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));

    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/use the search below/i);
  });

  it('clears the complaint as soon as they start fixing it', async () => {
    render(<QrScanner onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Type the code/ }));
    await userEvent.type(screen.getByLabelText('Pass code'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Pass code'), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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


describe('which camera it asks for', () => {
  it('asks a handheld device for its rear camera', () => {
    setPointer('touch');
    expect(preferredCamera()).toBe('environment');
  });

  it('asks a laptop for its front camera, being the only one it has', () => {
    // Asking a desktop for `environment` is what made this work on a phone and
    // fail on a laptop.
    setPointer('mouse');
    expect(preferredCamera()).toBe('user');
  });

  it('treats a touchscreen laptop as a laptop', () => {
    // Fine pointer, so it is driven with a mouse and has no rear camera --
    // even though the screen happens to accept touch.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 10 });
    expect(preferredCamera()).toBe('user');
  });

  it('passes that choice to the camera', async () => {
    setPointer('touch');
    const asked: MediaStreamConstraints[] = [];
    setCamera((constraints) => {
      asked.push(constraints as MediaStreamConstraints);
      return Promise.reject(new Error('no camera in jsdom'));
    });
    render(<QrScanner onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    const video = asked[0]?.video as { facingMode?: string };
    expect(video.facingMode).toBe('environment');
  });

  it('retries without a facing preference when the browser refuses it', async () => {
    // Some browsers reject a facingMode they cannot satisfy instead of falling
    // back to the one camera they do have.
    setPointer('mouse');
    const asked: MediaStreamConstraints[] = [];
    setCamera((constraints) => {
      asked.push(constraints as MediaStreamConstraints);
      return Promise.reject(new Error('OverconstrainedError'));
    });
    render(<QrScanner onScan={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start camera' }));

    expect(asked).toHaveLength(2);
    expect((asked[0].video as { facingMode?: string }).facingMode).toBe('user');
    expect((asked[1].video as { facingMode?: string }).facingMode).toBeUndefined();
  });
});


describe('looksLikePassCode', () => {
  it('accepts a real sixteen-character token', () => {
    expect(looksLikePassCode('ABCD1234EFGH5678')).toBe(true);
  });

  it('accepts one typed with spaces or dashes', () => {
    expect(looksLikePassCode('abcd-1234 efgh-5678')).toBe(true);
  });

  it('accepts the letters Crockford folds', () => {
    // I and L read as 1, O reads as 0 -- the same normalisation the server does.
    expect(looksLikePassCode('ABCDIL34EFGHO678')).toBe(true);
  });

  it('rejects a person\'s name', () => {
    expect(looksLikePassCode('Siddhant Narula')).toBe(false);
  });

  it('rejects a phone number', () => {
    expect(looksLikePassCode('9982200768')).toBe(false);
  });

  it('rejects the right characters at the wrong length', () => {
    expect(looksLikePassCode('ABCD1234')).toBe(false);
    expect(looksLikePassCode('ABCD1234EFGH56789')).toBe(false);
  });
});
