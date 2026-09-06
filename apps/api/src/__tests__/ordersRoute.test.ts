/**
 * Covers the converted `PATCH /:id/status` route: it used to gate on
 * `requireRole('owner', 'admin')` and now gates on
 * `requirePermission('orders', 'write')` (packages/db/src/permissions.ts).
 * Tests authorization, no-op transitions, and the route's atomic-transition
 * wiring into the outbox/ETA/ledger guards. Shared postOrderDeliveredEntry
 * and notification content behavior remains covered by admin's suite.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Role } from '@irth/db';
import * as dbExports from '@irth/db';

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

afterEach(() => vi.restoreAllMocks());

describe('PATCH /api/orders/:id/status', () => {
  it('rejects a member with 403 before touching the database', async () => {
    const app = buildApp({ orgId: 'org-1', userId: 'user-1', role: 'member' });
    const res = await patchStatus(app, 'confirmed');

    expect(res.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('lets an admin through to update the status', async () => {
    // Same status in and out: the route's transition guards (outbox emit,
    // ETA submission, ledger posting) all key on the locked previous status,
    // so a no-op transition exercises the authorization + response wiring
    // without pulling in that machinery.
    const order = { id: ORDER_ID, orderNumber: 'IRT-2026-0001', status: 'confirmed', totalAmountMinor: 0n, currency: 'EGP' };
    vi.mocked(db.select).mockReturnValue(chainable([order]) as never);
    const tx = chainable([order]);
    tx.execute = vi.fn(async () => [{ previous_status: order.status }]);
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
    tx.execute = vi.fn(async () => [{ previous_status: order.status }]);
    vi.mocked(withOrg).mockImplementation((_c, fn) => (fn as (tx: unknown) => Promise<unknown>)(tx));

    const app = buildApp({ orgId: 'org-1', userId: 'user-1', role: 'owner' });
    const res = await patchStatus(app, 'confirmed');

    expect(res.status).toBe(200);
  });
});

describe('PATCH order status — atomic transition wiring', () => {
  const orgId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

  async function transitionStatus(staleStatus: string, previousStatus: string, status = 'delivered') {
    const order = { id: ORDER_ID, orgId, orderNumber: 'F02', status: staleStatus, totalAmountMinor: 11400n, currency: 'EGP', customerId: 'customer-1' };
    vi.mocked(db.select).mockReturnValue(chainable([order]) as never);
    const tx = chainable([{ ...order, status }]);
    vi.mocked(withOrg).mockImplementation((_c, fn) => (fn as (tx: unknown) => Promise<unknown>)(tx));
    const transition = vi.spyOn(dbExports, 'transitionOrderStatus').mockResolvedValue({ previousStatus });
    const posting = vi.spyOn(dbExports, 'postOrderDeliveredEntry').mockResolvedValue(null);
    const notification = vi.spyOn(dbExports, 'buildOrderNotification').mockResolvedValue({ orderNumber: 'F02', customerPhone: '+201000000000' });
    const outbox = vi.spyOn(dbExports, 'emitOutboxEvent').mockResolvedValue(undefined);

    const response = await patchStatus(buildApp({ orgId, userId: 'user-1', role: 'admin' }), status);
    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledExactlyOnceWith(tx, { orgId, orderId: ORDER_ID, newStatus: status });
    return { tx, posting, notification, outbox };
  }

  it('uses the atomic result when a concurrent caller already delivered the order', async () => {
    const { tx, posting, outbox } = await transitionStatus('shipped', 'delivered');
    expect(posting).toHaveBeenCalledWith(tx, expect.objectContaining({ previousStatus: 'delivered', newStatus: 'delivered' }));
    expect(outbox).not.toHaveBeenCalled();
  });

  it('posts and queues ETA when the atomic result identifies a genuine delivery', async () => {
    const { tx, posting, outbox } = await transitionStatus('delivered', 'shipped');
    expect(posting).toHaveBeenCalledWith(tx, expect.objectContaining({ previousStatus: 'shipped', newStatus: 'delivered' }));
    expect(outbox).toHaveBeenCalledExactlyOnceWith(tx, {
      orgId, eventType: 'eta.invoice.issue', payload: { orgId, orderId: ORDER_ID },
    });
  });

  it('API confirmation uses the atomic status to suppress a duplicate customer notification', async () => {
    const { notification, outbox } = await transitionStatus('pending', 'confirmed', 'confirmed');
    expect(notification).not.toHaveBeenCalled();
    expect(outbox).not.toHaveBeenCalled();
  });
});
