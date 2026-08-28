/**
 * Unit tests for the Hono middleware itself — mirrors requireRole's shape,
 * but authorizes against the shared resource.action matrix
 * (packages/db/src/permissions.ts) instead of a fixed role list. See
 * orgResolution.test.ts for the buildApp() + app.request() pattern this
 * follows.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Role } from '@irth/db';
import { requirePermission } from '../middlewares/requirePermission';

function buildApp(ctx: { orgId?: string; role?: Role }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.orgId !== undefined) c.set('orgId', ctx.orgId);
    if (ctx.role !== undefined) c.set('role', ctx.role);
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

  it('401s when role is missing', async () => {
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
});
