import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adminRoot = path.resolve(import.meta.dirname, '..');
const publicRoot = path.join(adminRoot, 'public');

function pngSize(filename: string) {
  const data = readFileSync(path.join(publicRoot, filename));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe('PWA assets', () => {
  it('provides an installable standalone manifest with any and maskable icons', () => {
    const manifest = JSON.parse(readFileSync(path.join(publicRoot, 'manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({
      name: 'REPLAY Admin',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]));
  });

  it.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ])('ships %s at the declared square size', (filename, size) => {
    expect(existsSync(path.join(publicRoot, filename))).toBe(true);
    expect(pngSize(filename)).toEqual({ width: size, height: size });
  });

  it('keeps private API and Cloudflare Access traffic out of the service-worker cache', () => {
    const worker = readFileSync(path.join(publicRoot, 'sw.js'), 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.pathname.startsWith('/cdn-cgi/')");
    expect(worker).not.toContain('API_CACHE');
  });
});
