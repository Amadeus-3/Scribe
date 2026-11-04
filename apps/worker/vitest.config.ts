import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tsconfig sets rootDir: "src", so tests live alongside the code they cover.
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
