/**
 * Covers the converted `PATCH /:id/status` route: it used to gate on
 * `requireRole('owner', 'admin')` and now gates on
 * `requirePermission('orders', 'write')` (packages/db/src/permissions.ts).
 * Only the authorization boundary and the no-op-transition path are under
 * test here — the outbox/ETA/ledger side effects on an actual status
 * transition are covered by the admin router's equivalent
 * (apps/admin/src/__tests__/routers/orders.test.ts) and are out of scope for
 * this narrow migration.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Role } from '@irth/db';

vi.mock('../db', () => ({
  db: { select: vi.fn() },
  getDb: vi.fn(),
  withOrg: vi.fn(),
}));

import { db, withOrg } from '../db';
import { ordersRoute } from '../routes/orders';

const ORDER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'update', 'set', 'returning', 'insert', 'values', 'orderBy', 'limit', 'offset']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function buildApp(ctx: { orgId?: string; userId?: string; role?: Role }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (ctx.orgId !== undefined) c.set('orgId', ctx.orgId);
    if (ctx.userId !== undefined) c.set('userId', ctx.userId);
    if (ctx.role !== undefined) c.set('role', ctx.role);
    await next();
  });
  app.route('/api/orders', ordersRoute);
  return app;
}

function patchStatus(app: Hono, status: string) {
  return app.request(`/api/orders/${ORDER_ID}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

beforeEach(() => {
  vi.mocked(db.select).mockReset();
  vi.mocked(withOrg).mockReset();
});

describe('PATCH /api/orders/:id/status', () => {
  it('rejects a member with 403 before touching the database', async () => {
    const app = buildApp({ orgId: 'org-1', userId: 'user-1', role: 'member' });
    const res = await patchStatus(app, 'confirmed');

    expect(res.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('lets an admin through to update the status', async () => {
    // Same status in and out: the route's transition guards (outbox emit,
    // ETA submission, ledger posting) all key on `order.status !== status`,
    // so a no-op transition exercises the authorization + response wiring
    // without pulling in that machinery.
    const order = { id: ORDER_ID, orderNumber: 'IRT-2026-0001', status: 'confirmed', totalAmountMinor: 0n, currency: 'EGP' };
    vi.mocked(db.select).mockReturnValue(chainable([order]) as never);
    const tx = chainable([order]);
    vi.mocked(withOrg).mockImplementation((_c, fn) => (fn as (tx: unknown) => Promise<unknown>)(tx));

    const app = buildApp({ orgId: 'org-1', userId: 'user-1', role: 'admin' });
    const res = await patchStatus(app, 'confirmed');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('confirmed');
  });

  it('lets an owner through to update the status', async () => {
    const order = { id: ORDER_ID, orderNumber: 'IRT-2026-0002', status: 'confirmed', totalAmountMinor: 0n, currency: 'EGP' };
    vi.mocked(db.select).mockReturnValue(chainable([order]) as never);
    const tx = chainable([order]);
    vi.mocked(withOrg).mockImplementation((_c, fn) => (fn as (tx: unknown) => Promise<unknown>)(tx));

    const app = buildApp({ orgId: 'org-1', userId: 'user-1', role: 'owner' });
    const res = await patchStatus(app, 'confirmed');

    expect(res.status).toBe(200);
  });
});
