import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { captureEnv } from '../db';

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return {
    ...actual,
    db: { _mockDb: true } as any,
  };
});

describe('auth baseURL configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {}; // wipe out process.env
    captureEnv(null as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('falls back to localhost in non-production when API_BASE_URL is unset', async () => {
    captureEnv({ NODE_ENV: 'development', BETTER_AUTH_SECRET: 'secret', DATABASE_URL: 'postgres://test' } as any);
    vi.resetModules();
    const authModule = await import('../auth');
    const baseURL = authModule.auth.options.baseURL;
    expect(baseURL).toBe('http://localhost:8787');
  });

  it('logs loudly but does not throw in production when API_BASE_URL is unset', async () => {
    // Throwing here would 500 every authenticated request on a Worker that
    // never had the variable set; the pre-existing fallback is kept and the
    // misconfiguration is surfaced in the logs instead.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    captureEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'secret', DATABASE_URL: 'postgres://test' } as any);
    vi.resetModules();
    const authModule = await import('../auth');
    expect(authModule.auth.options.baseURL).toBe('http://localhost:8787');
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('API_BASE_URL is not set in production'));
    logged.mockRestore();
  });

  it('uses API_BASE_URL in production when it is set', async () => {
    captureEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'secret', API_BASE_URL: 'https://api.irth-house.com', DATABASE_URL: 'postgres://test' } as any);
    vi.resetModules();
    const authModule = await import('../auth');
    const baseURL = authModule.auth.options.baseURL;
    expect(baseURL).toBe('https://api.irth-house.com');
  });
});
