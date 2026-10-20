import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { sendSms } from '../services/sms';
import { dbContext, captureEnv } from '../db';
import { Hono } from 'hono';
import * as domain from '@irth/domain';

vi.mock('@irth/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/domain')>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  };
});

describe('sendSms', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {}; // wipe out process.env
    captureEnv(null as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads secrets via envVar (request env), not just process.env', async () => {
    const app = new Hono();

    vi.mocked(domain.fetchWithTimeout).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sid: 'mock-sid' }),
    } as any);

    let sentResult;
    app.use('*', dbContext());
    app.get('/', async (c) => {
      sentResult = await sendSms({ to: '+1234567890', body: 'Test' });
      return c.json({ ok: true });
    });

    // Provide the variables through the worker request context (`c.env`)
    // which `dbContext` puts into `getEnv()`, and `envVar()` reads.
    await app.request('/', { method: 'GET' }, {
      SMS_BASE_URL: 'https://api.example.com',
      SMS_ACCOUNT_SID: 'AC123',
      SMS_AUTH_TOKEN: 'token123',
      SMS_FROM: 'TEST',
    });

    expect(domain.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(domain.fetchWithTimeout).toHaveBeenCalledWith(
      'https://api.example.com/2010-04-01/Accounts/AC123/Messages.json',
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(sentResult).toEqual({ sid: 'mock-sid' });
  });

  it('throws an error if secrets are missing', async () => {
    await expect(sendSms({ to: '+1234567890', body: 'Test' })).rejects.toThrow('Missing SMS environment variables');
  });
});
