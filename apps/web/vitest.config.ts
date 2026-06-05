import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit/component tests live under src; Playwright e2e specs are excluded so
    // the Vitest runner never tries to execute them.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    environment: 'node',
  },
});
