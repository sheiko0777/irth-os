import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke test for the admin: a real Next production build, a real
 * Postgres with every migration applied, and a real login through the UI.
 * Unit and integration suites prove the routers and the database; this proves
 * the screens an operator uses actually render and work end to end.
 *
 * Requires DATABASE_URL (a disposable database — seed.setup.ts writes to it),
 * BETTER_AUTH_SECRET and NEXT_PUBLIC_APP_URL=http://localhost:3100, and a
 * prior `next build`. See the `e2e` job in .github/workflows/ci.yml.
 *
 * PW_CHROMIUM_PATH lets an environment with a preinstalled Chromium point at
 * it instead of downloading one.
 */
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ar-EG',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'setup', testMatch: /seed\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
