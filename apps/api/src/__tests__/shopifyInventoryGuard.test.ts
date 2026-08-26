/**
 * The orders/create webhook's idempotency-race fix: two concurrent
 * deliveries of the same order can both pass the pre-check `alreadySynced`
 * SELECT before either commits, and lose the race on the DB-level unique
 * index on (org_id, shopify_order_id) instead. Before this fix, nothing
 * caught that violation, so the losing request surfaced as an unhandled 500
 * rather than the same `{alreadyProcessed:true}` response a genuine
 * duplicate delivery already gets.
 *
 * The guarded-decrement/floor/shortfall arithmetic this same handler now
 * uses is verified against real Postgres instead of mocked here — see
 * apps/admin/src/__tests__/integration/idempotency.test.ts's "stock guard —
 * Shopify shortfall" block, which exercises the identical pattern under
 * concurrency (a mock cannot prove a WHERE-clause guard holds; that is
 * database behaviour). Mocking this file's full transaction (a dozen tables:
 * customers, productVariants, inventoryItems, inventoryMovements, orders,
 * orderItems, inventoryDiscrepancies, orgMembers, notifications) just to
 * re-prove the same arithmetic in miniature would be a large, brittle test
 * for no additional coverage.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../middlewares/verifyShopifyWebhook', () => ({
  verifyShopifyWebhook: () => async (c: import('hono').Context, next: () => Promise<void>) => {
    c.set('rawBody', await c.req.text());
    await next();
  },
}));

vi.mock('../db', () => ({
  getDb: () => ({
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        then: (resolve: (v: unknown) => void) => Promise.resolve(selectQueue.shift() ?? []).then(resolve),
      };
      return chain;
    }),
  }),
  getEnv: () => ({ SHOPIFY_ORG_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
}));

vi.mock('@irth/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@irth/db')>();
  return {
    ...actual,
    withOrgContext: vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })),
  };
});

// Populated per-test, consumed in call order by the mocked `getDb().select()` above.
let selectQueue: unknown[][] = [];

import { shopifyWebhookRoute } from '../routes/webhooks/shopify';

function buildApp() {
  const app = new Hono();
  app.route('/webhooks/shopify', shopifyWebhookRoute);
  return app;
}

const ORDER_PAYLOAD = {
  id: 555111,
  name: '#1001',
  financial_status: 'paid',
  cancelled_at: null,
  currency: 'EGP',
  total_price: '100.00',
  line_items: [],
};

describe('orders/create — idempotency race', () => {
  it('catches a 23505 unique-violation raised by a concurrent duplicate delivery and returns alreadyProcessed', async () => {
    // 1st select: the alreadySynced pre-check — empty, this delivery thinks
    // it's the first. withOrgContext then throws 23505 (mocked above),
    // simulating the concurrent winner committing in between. 2nd select:
    // the post-catch re-check — now finds the row the winner just committed.
    selectQueue = [[], [{ id: 'order-1' }]];

    const res = await buildApp().request('/webhooks/shopify/orders-create', {
      method: 'POST',
      body: JSON.stringify(ORDER_PAYLOAD),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { alreadyProcessed: true }, error: null, meta: null });
  });

  it('re-throws when the post-catch re-check finds no row (a genuine, different failure)', async () => {
    selectQueue = [[], []];

    const res = await buildApp().request('/webhooks/shopify/orders-create', {
      method: 'POST',
      body: JSON.stringify(ORDER_PAYLOAD),
    });

    // Falls through to Hono's default error handling — not the 200
    // alreadyProcessed shortcut, since this was not actually a duplicate.
    expect(res.status).not.toBe(200);
  });
});
