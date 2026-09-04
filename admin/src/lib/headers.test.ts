import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The scanner's real dependency is a response header, not a line of code.
 *
 * `Permissions-Policy: camera=()` disables the camera for every origin
 * including this one, and the failure is invisible in the source: the JS is
 * correct, `getUserMedia` simply rejects. It cost two speculative fixes to
 * find, and nothing else in the test suite can see it -- so it is asserted
 * here, against the file that actually ships.
 */
const HEADERS = readFileSync(join(__dirname, '../../public/_headers'), 'utf8');

describe('the shipped headers', () => {
  it('lets the library desk use the camera', () => {
    const policy = HEADERS.match(/^\s*Permissions-Policy: (.+)$/m)?.[1] ?? '';
    expect(policy).toContain('camera=(self)');
    expect(policy).not.toContain('camera=()');
  });

  it('still refuses everything the admin does not use', () => {
    const policy = HEADERS.match(/^\s*Permissions-Policy: (.+)$/m)?.[1] ?? '';
    for (const feature of ['microphone=()', 'geolocation=()', 'payment=()']) {
      expect(policy).toContain(feature);
    }
  });

  it('still lets the app reach its own API and nothing else', () => {
    const csp = HEADERS.match(/^\s*Content-Security-Policy: (.+)$/m)?.[1] ?? '';
    expect(csp).toContain("connect-src 'self' https://api.replaycon.in");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
