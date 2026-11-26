import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Format tests download signed DuckDB extensions on a cold cache (spatial is about 80 MB), so
    // the 5 second default is too short for the first run after a DuckDB upgrade.
    testTimeout: 120_000,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        statements: 36,
        branches: 36,
        functions: 34,
        lines: 37,
      },
    },
  },
});
