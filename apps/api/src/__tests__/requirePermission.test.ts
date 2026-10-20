/**
 * Unit tests for the Hono middleware itself: it authorizes against the
 * member's effective access (role permissions + per-person grants − revokes,
 * packages/db/src/permissions.ts), never the role name. See
 * orgResolution.test.ts for the buildApp() + app.request() pattern this
 * follows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { auditLog, effectiveAccess, resetDenialThrottle, DENIAL_CAP_PER_MINUTE, type EffectiveAccess, type Role } from '@irth/db';
import { requirePermission } from '../middlewares/requirePermission';

// Denials are audited through withOrg(c, …); record the rows instead of
// touching a database.
const audited = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../db', () => ({
  withOrg: vi.fn(async (_c: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => { if (table === auditLog) audited.push(row); },
    }),
  })),
}));

beforeEach(() => {
  audited.length = 0;
  resetDenialThrottle();
});

function buildApp(ctx: { orgId?: string; role?: Role; access?: EffectiveAccess; userId?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.userId !== undefined) c.set('userId', ctx.userId);
    if (ctx.orgId !== undefined) c.set('orgId', ctx.orgId);
    if (ctx.role !== undefined) c.set('role', ctx.role);
    const access = ctx.access ?? (ctx.role ? effectiveAccess({ systemKey: ctx.role }) : undefined);
    if (access) c.set('access', access);
    await next();
  });
  app.get('/products', requirePermission('products', 'view'), (c) => c.json({ ok: true }));
  app.delete('/products/:id', requirePermission('products', 'delete'), (c) => c.json({ ok: true }));
  return app;
}

describe('requirePermission', () => {
  it('401s when orgId is missing', async () => {
    const res = await buildApp({ role: 'owner' }).request('/products');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ data: null, error: 'Unauthorized', meta: null });
  });

  it('401s when access is missing', async () => {
    const res = await buildApp({ orgId: 'org-1' }).request('/products');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ data: null, error: 'Unauthorized', meta: null });
  });

  it('403s a role that lacks the permission', async () => {
    // products.delete is owner-only per the matrix — admin is not enough.
    const res = await buildApp({ orgId: 'org-1', role: 'admin' }).request('/products/p1', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ data: null, error: 'Forbidden', meta: null });
  });

  it('403s a member on an admin-only action', async () => {
    const res = await buildApp({ orgId: 'org-1', role: 'member' }).request('/products/p1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('calls next() and reaches the handler when the role has the permission', async () => {
    const res = await buildApp({ orgId: 'org-1', role: 'member' }).request('/products');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('allows the owner on an owner-only action', async () => {
    const res = await buildApp({ orgId: 'org-1', role: 'owner' }).request('/products/p1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('a per-person grant lets a member delete; a revoke takes view from the admin', async () => {
    const granted = effectiveAccess({ systemKey: 'member', overrides: { grant: { products: ['delete'] } } });
    expect((await buildApp({ orgId: 'org-1', role: 'member', access: granted }).request('/products/p1', { method: 'DELETE' })).status).toBe(200);
    const revoked = effectiveAccess({ systemKey: 'admin', overrides: { revoke: { products: ['view'] } } });
    expect((await buildApp({ orgId: 'org-1', role: 'admin', access: revoked }).request('/products')).status).toBe(403);
  });

  it('decides on access, not on the role name', async () => {
    const res = await buildApp({ orgId: 'org-1', role: 'owner', access: effectiveAccess({ systemKey: 'member' }) })
      .request('/products/p1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});

describe('requirePermission — denials are audited (CX-05)', () => {
  it('a 403 writes exactly one outcome=denied row with the route, not the request body', async () => {
    const res = await buildApp({ orgId: 'org-1', role: 'member', userId: 'user-1' })
      .request('/products/p1', { method: 'DELETE', body: JSON.stringify({ secret: 'do-not-log' }) });
    expect(res.status).toBe(403);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      orgId: 'org-1', userId: 'user-1', action: 'PERMISSION_DENIED', outcome: 'denied', channel: 'api',
      changes: { path: 'DELETE /products/:id', permission: 'products.delete' },
    });
    expect(JSON.stringify(audited[0])).not.toContain('do-not-log');
  });

  it('an allowed call and a 401 write nothing', async () => {
    await buildApp({ orgId: 'org-1', role: 'member', userId: 'user-1' }).request('/products');
    await buildApp({ role: 'member', userId: 'user-1' }).request('/products');
    expect(audited).toHaveLength(0);
  });

  it(`caps at ${DENIAL_CAP_PER_MINUTE} rows per actor per minute; the next denial writes nothing but still 403s`, async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId', 'user-1');
      c.set('orgId', 'org-1');
      c.set('access', effectiveAccess({ systemKey: 'member' }));
      await next();
    });
    // Distinct routes, so the per-path dedupe does not hide the per-actor cap.
    for (let i = 0; i <= DENIAL_CAP_PER_MINUTE; i++) {
      app.delete(`/r${i}`, requirePermission('products', 'delete'), (c) => c.json({ ok: true }));
    }
    for (let i = 0; i <= DENIAL_CAP_PER_MINUTE; i++) {
      expect((await app.request(`/r${i}`, { method: 'DELETE' })).status).toBe(403);
    }
    expect(audited).toHaveLength(DENIAL_CAP_PER_MINUTE);
  });

  it('repeats of the same denied route collapse to one row per minute', async () => {
    const app = buildApp({ orgId: 'org-1', role: 'member', userId: 'user-1' });
    for (let i = 0; i < 3; i++) {
      expect((await app.request(`/products/p${i}`, { method: 'DELETE' })).status).toBe(403);
    }
    expect(audited).toHaveLength(1);
  });
});
