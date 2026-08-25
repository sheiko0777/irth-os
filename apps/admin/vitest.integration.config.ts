import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Separate from vitest.config.ts on purpose.
 *
 * The unit config loads `src/__tests__/setup.ts`, which replaces `@irth/db`'s
 * `db` with a chainable mock for every test in the project. An integration test
 * living under that config would silently receive the mock and pass without
 * touching Postgres — the exact failure mode this suite exists to rule out.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/integration/**/*.test.ts'],
    globalSetup: ['./src/__tests__/integration/globalSetup.ts'],
    setupFiles: ['./src/__tests__/integration/setup.ts'],
    // One connection pool and one schema, shared: parallel files would truncate
    // each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
