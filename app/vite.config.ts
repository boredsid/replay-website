import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  // The library catalogue lives at the repo root, shared with the public site,
  // so the dev server has to be allowed to read above the app's own root. It is
  // imported dynamically, which keeps it out of the main bundle.
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
