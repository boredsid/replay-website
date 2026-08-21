import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from './apps-script';

const env = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test/exec',
  APPS_SCRIPT_SECRET: 'test-secret',
} as any;

const payload = {
  template: 'replay-registration' as const,
  to: 'guest@example.com',
  subject: 'Registration confirmed',
  variables: { name: 'Guest' },
};

describe('sendEmail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts only an explicit ok response and signs the request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendEmail(env, payload)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    const signature = new URL(String(url)).searchParams.get('X-Signature');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect((init as RequestInit).headers).toMatchObject({ 'X-Signature': signature });
    const envelope = JSON.parse(String((init as RequestInit).body));
    expect(JSON.parse(Buffer.from(envelope.payload_base64, 'base64').toString('utf8'))).toEqual(payload);
  });

  it('preserves non-ASCII subjects and variables inside the signed envelope', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const unicodePayload = {
      ...payload,
      subject: 'REPLAY 3rd edition — registration confirmed',
      variables: { name: 'Siddhānt' },
    };

    await sendEmail(env, unicodePayload);

    const [, init] = fetchMock.mock.calls[0];
    const envelope = JSON.parse(String((init as RequestInit).body));
    expect(JSON.parse(Buffer.from(envelope.payload_base64, 'base64').toString('utf8'))).toEqual(unicodePayload);
  });

  it('rejects a successful HTTP response with an error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'bad signature' }), { status: 200 })));

    await expect(sendEmail(env, payload)).rejects.toThrow('Apps Script rejected email: bad signature');
  });

  it('rejects an invalid response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));

    await expect(sendEmail(env, payload)).rejects.toThrow('Apps Script returned an invalid response');
  });

  it('rejects a non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));

    await expect(sendEmail(env, payload)).rejects.toThrow('Apps Script returned 500');
  });
});
