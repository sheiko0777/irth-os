import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { effectiveAccess, type EffectiveAccess, type Role } from '@irth/db';

vi.mock('../ai/providers/groq', () => ({
  createGroqProvider: vi.fn(() => ({
    name: 'groq',
    model: 'llama-3.1-8b-instant',
    complete: vi.fn(async () => ({
      model: 'llama-3.1-8b-instant',
      content: 'Hello, this is a mock response.',
      toolCalls: [],
    })),
  })),
}));

vi.mock('../db', () => ({
  withOrg: vi.fn(async (_c, fn) => fn({
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
  })),
}));

// Mock envVar used by rateLimit inside the router
vi.mock('../utils/env', () => ({
  envVar: vi.fn((key: string) => {
    if (key === 'TRUSTED_PROXY_COUNT') return '0';
    return '';
  }),
}));

// Mock rateLimit to pass through
vi.mock('../middlewares/rateLimit', () => ({
  rateLimit: vi.fn(() => async (_c: any, next: any) => next()),
}));

import { aiChatRouter } from '../ai/route';

function buildApp(ctx: { orgId?: string; role?: Role; access?: EffectiveAccess; userId?: string } | null) {
  const app = new Hono();

  if (ctx) {
    app.use('*', async (c, next) => {
      if (ctx.orgId) c.set('orgId', ctx.orgId);
      if (ctx.role) c.set('role', ctx.role);
      if (ctx.access) c.set('access', ctx.access);
      if (ctx.userId) c.set('userId', ctx.userId);
      await next();
    });
  }

  app.route('/', aiChatRouter);
  return app;
}

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('AI Chat Route Authorization', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp(null);
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 for a role without dashboard:view', async () => {
    // We need a role that does NOT have dashboard:view.
    // Let's create an effective access with a revoke override for dashboard:view
    // since 'member' actually does have dashboard:view in PERMISSIONS matrix.
    const access = effectiveAccess({
      systemKey: 'member',
      overrides: { revoke: { dashboard: ['view'] } }
    });

    const app = buildApp({ orgId: ORG_ID, role: 'member', access, userId: 'u-1' });

    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Forbidden');
  });

  it('reaches the handler for a role with dashboard:view', async () => {
    // Admin role has dashboard:view by default.
    const access = effectiveAccess({ systemKey: 'admin' });
    const app = buildApp({ orgId: ORG_ID, role: 'admin', access, userId: 'u-1' });

    const res = await app.request('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });

    // 200 means it successfully passed middleware and hit the handler
    expect(res.status).toBe(200);
    const body = await res.json() as { error: string | null; data: { message: { content: string } } };
    expect(body.error).toBeNull();
    expect(body.data.message.content).toBe('Hello, this is a mock response.');
  });
});
