import '@testing-library/jest-dom/vitest';

// jsdom has no layout, so scrollTo is unimplemented and logs a notice on every
// test that scrolls. The behaviour is asserted where it matters by stubbing it
// per test; this only keeps the rest of the output readable.
Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: () => {} });
