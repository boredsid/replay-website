import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  clearDevice,
  isCompleteCode,
  loadDevice,
  normalizeCode,
  pairDevice,
  saveDevice,
  type Device,
} from './device';

const API = 'https://api.replaycon.in';

function device(overrides: Partial<Device> = {}): Device {
  return {
    token: 'tok',
    qr_token: 'QRQRQRQRQRQRQRQR',
    display_name: 'Priya',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('normalizeCode', () => {
  it('accepts what someone types off a kiosk screen', () => {
    expect(normalizeCode('a1b2-c3d4')).toBe('A1B2C3D4');
    expect(normalizeCode(' a1 b2 c3 d4 ')).toBe('A1B2C3D4');
  });

  it('folds the characters people misread', () => {
    // O reads as 0; I and L read as 1. Matching the Worker exactly matters —
    // if these two ever disagree, valid codes start being refused.
    expect(normalizeCode('OIL')).toBe('011');
  });
});

describe('isCompleteCode', () => {
  it('accepts eight Crockford characters', () => {
    expect(isCompleteCode('A1B2C3D4')).toBe(true);
  });

  it.each([['short', 'A1B2C3D'], ['long', 'A1B2C3D4E'], ['unfolded letter', 'A1B2C3DO'], ['empty', '']])(
    'rejects a %s code', (_why, code) => expect(isCompleteCode(code)).toBe(false),
  );
});

describe('loadDevice', () => {
  it('returns nothing when nothing is stored', () => {
    expect(loadDevice()).toBeNull();
  });

  it('round-trips a saved device', () => {
    saveDevice(device());
    expect(loadDevice()).toMatchObject({ display_name: 'Priya' });
  });

  it('discards an expired device rather than presenting a dead pass', () => {
    saveDevice(device({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(loadDevice()).toBeNull();
    expect(localStorage.getItem('replay.device')).toBeNull();
  });

  it('ignores corrupt storage instead of throwing', () => {
    localStorage.setItem('replay.device', '{not json');
    expect(loadDevice()).toBeNull();
  });

  it('ignores a stored object missing fields', () => {
    localStorage.setItem('replay.device', JSON.stringify({ token: 'x' }));
    expect(loadDevice()).toBeNull();
  });

  it('survives storage that throws outright', () => {
    // A private window, or a browser set to block site data.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadDevice()).toBeNull();
  });
});

describe('clearDevice', () => {
  it('removes the stored device', () => {
    saveDevice(device());
    clearDevice();
    expect(loadDevice()).toBeNull();
  });
});

describe('pairDevice', () => {
  it('stores the device on success', async () => {
    const payload = device();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const result = await pairDevice(API, 'a1b2-c3d4');

    expect(result).toMatchObject({ ok: true });
    expect(loadDevice()).toMatchObject({ display_name: 'Priya' });
  });

  it('sends the normalised code, not what was typed', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(JSON.stringify(device()), { status: 200 });
    }));

    await pairDevice(API, 'a1b2-c3d4');

    expect(JSON.parse(sent[0])).toEqual({ code: 'A1B2C3D4' });
  });

  it('rejects an incomplete code without calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await pairDevice(API, 'A1B2');

    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a refused code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'pairing_failed' }), { status: 400 })));
    expect(await pairDevice(API, 'A1B2C3D4')).toEqual({ ok: false, reason: 'rejected' });
  });

  it('distinguishes being offline from being refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    // The app tells someone to try again, not to go back to the desk.
    expect(await pairDevice(API, 'A1B2C3D4')).toEqual({ ok: false, reason: 'offline' });
  });

  it('reports a server failure separately again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    expect(await pairDevice(API, 'A1B2C3D4')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('stores nothing when the response is not a device', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'only' }), { status: 200 })));
    const result = await pairDevice(API, 'A1B2C3D4');
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadDevice()).toBeNull();
  });
});
