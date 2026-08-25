import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Without an explicit include, vitest defaults to **/*.test.ts and picks up
    // the integration suite — which then runs under this config's db mock and
    // without TEST_DATABASE_URL. Integration runs via vitest.integration.config.ts.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/__tests__/integration/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
