import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from '../middlewares/cors';
import { captureEnv, dbContext } from '../db';

describe('corsMiddleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {}; // wipe out process.env
    captureEnv(null as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows localhost origins in non-production', async () => {
    const app = new Hono();
    // Simulate the worker injecting env
    app.use('*', async (c, next) => {
      c.env = { NODE_ENV: 'development' };
      await next();
    });
    app.use('*', dbContext());
    app.use('*', corsMiddleware);
    app.get('/', (c) => c.text('ok'));

    const res = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('rejects localhost origins in production', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { NODE_ENV: 'production' };
      await next();
    });
    app.use('*', dbContext());
    app.use('*', corsMiddleware);
    app.get('/', (c) => c.text('ok'));

    const res = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows production origins in production', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { NODE_ENV: 'production' };
      await next();
    });
    app.use('*', dbContext());
    app.use('*', corsMiddleware);
    app.get('/', (c) => c.text('ok'));

    const res = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.irth-house.com', 'Access-Control-Request-Method': 'GET' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.irth-house.com');
  });
});
