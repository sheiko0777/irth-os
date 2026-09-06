/** Bosta's atomic order transition must gate ledger posting and ETA on the locked status. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import * as dbExports from '@irth/db';

vi.mock('../db', () => ({
  db: { select: vi.fn() },
  getDb: vi.fn(),
}));

// Signature verification is covered separately; supply its raw-body contract.
vi.mock('../middlewares/verifyWebhook', () => ({
  verifyHmac: () => async (c: { set: (k: string, v: unknown) => void; req: { text: () => Promise<string> } }, next: () => Promise<void>) => {
    c.set('rawBody', await c.req.text());
    await next();
  },
}));

import { db } from '../db';
import { bostaRoute } from '../routes/webhooks/bosta';

function chainable(finalValue: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit', 'update', 'set', 'insert', 'values']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
  return chain;
}

function post(body: unknown) {
  const app = new Hono();
  app.route('/', bostaRoute);
  return app.request('/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Bosta order status — atomic transition wiring', () => {
  const orgId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
  const orderId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  async function deliver(staleStatus: string, previousStatus: string) {
    const order = { id: orderId, orgId, orderNumber: 'F02', status: staleStatus, totalAmountMinor: 11400n, currency: 'EGP' };
    vi.mocked(db.select).mockReturnValue(chainable([{ id: 'shipment-1', orgId, orderId }]) as never);
    const tx = chainable([order]);
    vi.spyOn(dbExports, 'withOrgContext').mockImplementation((_db, _orgId, fn) => (fn as (tx: unknown) => Promise<unknown>)(tx));
    const transition = vi.spyOn(dbExports, 'transitionOrderStatus').mockResolvedValue({ previousStatus });
    const posting = vi.spyOn(dbExports, 'postOrderDeliveredEntry').mockResolvedValue(null);
    const outbox = vi.spyOn(dbExports, 'emitOutboxEvent').mockResolvedValue(undefined);

    const response = await post({ trackingNumber: 'F02', state: 'Delivered' });
    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledExactlyOnceWith(tx, { orgId, orderId, newStatus: 'delivered' });
    return { tx, posting, outbox };
  }

  it('uses the atomic result when a concurrent caller already delivered the order', async () => {
    const { posting, outbox } = await deliver('shipped', 'delivered');
    expect(posting).not.toHaveBeenCalled();
    expect(outbox).not.toHaveBeenCalled();
  });

  it('posts and queues ETA when the atomic result identifies a genuine delivery', async () => {
    const { tx, posting, outbox } = await deliver('delivered', 'shipped');
    expect(posting).toHaveBeenCalledWith(tx, expect.objectContaining({ previousStatus: 'shipped', newStatus: 'delivered' }));
    expect(outbox).toHaveBeenCalledExactlyOnceWith(tx, {
      orgId, eventType: 'eta.invoice.issue', payload: { orgId, orderId },
    });
  });
});
