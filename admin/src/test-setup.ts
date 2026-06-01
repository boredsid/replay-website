import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Bridge for @testing-library waitFor: it detects fake timers via `globalThis.jest`
// and falls back to draining microtasks via `setTimeout(0)`, which hangs when
// vitest fake timers are active. Exposing `vi` under the `jest` name lets RTL's
// fake-timer path drive vitest's clock instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).jest = vi;
