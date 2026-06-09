import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Integration tests need a live DB; they run via the integration config.
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/index.ts', 'src/generated/**'],
      // Spec §13 targets 80%+ on packages/core; thresholds are enforced from
      // Phase 7 once the bulk of domain logic (and its tests) has landed.
    },
  },
});
