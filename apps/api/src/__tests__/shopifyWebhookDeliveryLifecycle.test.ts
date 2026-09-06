/**
 * Regression test for the reviewed implementation plan's finding F01: a
 * webhook delivery whose insert-dedup row already exists is not the same
 * thing as "the business effect this delivery describes actually completed".
 *
 * Before this fix, `recordDelivery` returned `false` (meaning "already
 * processed, do not redo the work") the instant a row with the same
 * `(connectionId, webhookId)` existed — regardless of whether the ORIGINAL
 * request that inserted that row ever finished. A crash, timeout, or any
 * error between that insert and the business transaction committing left a
 * delivery row on record with nothing actually done; Shopify's automatic
 * redelivery (same webhook id) hit the unique constraint immediately and got
 * told "already processed" — the order was silently lost forever.
 *
 * `claimDelivery` fixes this by reading the existing row's durable `status`
 * column instead of just checking existence: only `'processed'` is safe to
 * skip. This file tests `claimDelivery`/`markDeliveryProcessed`/
 * `markDeliveryFailed` directly (not through the full HTTP route) — the
 * defect and its fix live entirely in this decision, and driving it through
 * `/orders-create` would require mocking that handler's entire order/stock/
 * ledger pipeline just to reach a check three lines into the request.
 *
 * Drizzle's real `eq()`/`and()` (deliberately left unmocked — see the
 * `@irth/db` mock below) produce opaque SQL AST objects, not plain
 * `{column: value}` shapes — the fake `db` below never tries to parse a
 * `where(...)` condition (a fake that did would silently never match
 * anything; see the extensive comment on this exact trap in
 * shopifyWebhookOrgResolution.test.ts in this same directory, hit for a
 * table-shape reason there instead of a where-condition one). Instead each
 * test tracks "which row is currently in play" itself, the same way that
 * file tracks `lastQueriedDomain` — this file only ever has one delivery row
 * in flight per test, so that is exact, not an approximation.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

// The route file imports a wide surface from '@irth/db' for handlers this
// test never exercises — plain non-throwing stand-ins so importing the
// module (to reach `claimDelivery` etc.) does not require the real package.
// Deliberately NOT spread from the real module (importOriginal) — see the
// comment on the identical choice in shopifyWebhookOrgResolution.test.ts.
vi.mock('@irth/db', () => ({
  orders: { id: 'id', orgId: 'orgId', shopifyOrderId: 'shopifyOrderId', status: 'status' },
  orderItems: { orderId: 'orderId', variantId: 'variantId', quantity: 'quantity' },
  customers: { id: 'id', orgId: 'orgId', shopifyCustomerId: 'shopifyCustomerId', email: 'email' },
  productVariants: { orgId: 'orgId', shopifyVariantId: 'shopifyVariantId', shopifyInventoryItemId: 'shopifyInventoryItemId' },
  inventoryItems: { id: 'id', orgId: 'orgId', variantId: 'variantId', quantity: 'quantity' },
  inventoryMovements: {},
  inventoryDiscrepancies: { orderId: 'orderId', variantId: 'variantId', appliedQuantity: 'appliedQuantity' },
  orgMembers: { orgId: 'orgId', role: 'role', userId: 'userId' },
  notifications: {},
  shopifyConnections: { id: 'id', orgId: 'orgId', shopDomain: 'shopDomain', status: 'status', lastWebhookAt: 'lastWebhookAt' },
  shopifyWebhookDeliveries: {
    id: 'id', orgId: 'orgId', connectionId: 'connectionId', webhookId: 'webhookId',
    topic: 'topic', payload: 'payload', status: 'status', error: 'error', processedAt: 'processedAt',
  },
  withOrgContext: vi.fn(),
  withAudit: vi.fn(),
  jsonSafe: (v: unknown) => v,
  nextDocumentNumber: vi.fn(),
  formatDocumentNumber: vi.fn(),
  emitOutboxEvent: vi.fn(),
  buildOrderNotification: vi.fn(),
  OUTBOX_EVENT_BY_STATUS: {},
}));
vi.mock('../middlewares/verifyShopifyWebhook', () => ({
  verifyShopifyWebhook: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import { claimDelivery, markDeliveryProcessed, markDeliveryFailed } from '../routes/webhooks/shopify';

interface FakeRow { id: string; connectionId: string; webhookId: string; status: string; error: string | null; processedAt: Date | null }

describe('claimDelivery / markDeliveryProcessed / markDeliveryFailed', () => {
  let rows: FakeRow[];
  // Set immediately before each real call, mirroring the "which row is this
  // request about" context claimDelivery/markDeliveryProcessed/Failed derive
  // from their own real arguments — a test-only stand-in for the Drizzle
  // `where(eq(...))` condition this fake deliberately does not parse.
  let inFlight: { connectionId: string; webhookId: string } | null = null;
  let targetId: string | null = null;

  beforeEach(() => {
    rows = [];
    inFlight = null;
    targetId = null;
  });

  function fakeDb() {
    return {
      insert: (_table: unknown) => ({
        values: async (row: { id: string; connectionId: string; webhookId: string; status: string }) => {
          if (rows.some((r) => r.connectionId === row.connectionId && r.webhookId === row.webhookId)) {
            throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
          }
          rows.push({ id: row.id, connectionId: row.connectionId, webhookId: row.webhookId, status: row.status, error: null, processedAt: null });
        },
      }),
      update: (_table: unknown) => ({
        set: (patch: Partial<FakeRow>) => ({
          where: async () => {
            const row = rows.find((r) => r.id === targetId);
            if (row) Object.assign(row, patch);
            // (shopifyConnections.lastWebhookAt bump inside claimDelivery's
            // success path also lands here, matched by nothing — a
            // harmless no-op, same as the sibling file's generic update mock.)
          },
        }),
      }),
      select: (_cols: unknown) => ({
        from: (_table: unknown) => ({
          where: async () => {
            if (!inFlight) return [];
            const row = rows.find((r) => r.connectionId === inFlight!.connectionId && r.webhookId === inFlight!.webhookId);
            return row ? [{ id: row.id, status: row.status }] : [];
          },
        }),
      }),
    };
  }

  const resolvedBase = { orgId: 'org-a', connectionId: 'conn-a' };
  function ctx(webhookId: string | undefined) {
    return { req: { header: (name: string) => (name === 'x-shopify-webhook-id' ? webhookId : undefined) } } as never;
  }

  async function claim(db: ReturnType<typeof fakeDb>, webhookId: string | undefined, connectionId: string | null = resolvedBase.connectionId) {
    inFlight = connectionId && webhookId ? { connectionId, webhookId } : null;
    return claimDelivery(db as never, { orgId: resolvedBase.orgId, connectionId }, ctx(webhookId), 'orders/create', {});
  }

  it('a genuinely new delivery is claimed as new', async () => {
    const db = fakeDb();
    const result = await claim(db, 'wh-1');
    expect(result).toMatchObject({ kind: 'new' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ connectionId: 'conn-a', webhookId: 'wh-1', status: 'received' });
  });

  it('THE F01 REGRESSION: a redelivery whose prior attempt never reached processed must be retried, not skipped', async () => {
    const db = fakeDb();
    // Simulate the crash: first delivery recorded, business effect never
    // completed — this is exactly the state a crash between the delivery
    // insert and the order transaction committing leaves behind. No call to
    // markDeliveryProcessed happened, so the row stays 'received'.
    const first = await claim(db, 'wh-2');
    expect(first).toMatchObject({ kind: 'new' });

    // Shopify's automatic redelivery, same webhook id.
    const retry = await claim(db, 'wh-2');

    // The old code returned `false` here (`recordDelivery`'s boolean
    // contract), which the caller treated as "already processed" and never
    // reattempted order creation. The fix must NOT report this as processed.
    expect(retry.kind).not.toBe('processed');
    expect(retry).toMatchObject({ kind: 'retry' });
  });

  it('a redelivery after the business effect genuinely completed is safely skipped', async () => {
    const db = fakeDb();
    const first = await claim(db, 'wh-3');
    if (first.kind !== 'new') throw new Error('expected a new claim');

    targetId = first.deliveryId;
    await markDeliveryProcessed(db as never, first.deliveryId);
    expect(rows[0].status).toBe('processed');
    expect(rows[0].processedAt).toBeInstanceOf(Date);

    const retry = await claim(db, 'wh-3');
    expect(retry).toEqual({ kind: 'processed' });
  });

  it('markDeliveryFailed records the error message on the targeted row', async () => {
    const db = fakeDb();
    const first = await claim(db, 'wh-4');
    if (first.kind !== 'new') throw new Error('expected a new claim');

    targetId = first.deliveryId;
    await markDeliveryFailed(db as never, first.deliveryId, new Error('token exchange failed'));
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'token exchange failed' });

    // A later redelivery still sees this as retryable, not processed.
    const retry = await claim(db, 'wh-4');
    expect(retry).toMatchObject({ kind: 'retry' });
  });

  it('markDeliveryFailed does not throw even if the underlying update fails', async () => {
    const throwingDb = {
      update: () => ({ set: () => ({ where: async () => { throw new Error('db unavailable'); } }) }),
    };
    await expect(markDeliveryFailed(throwingDb as never, 'delivery-x', new Error('boom'))).resolves.toBeUndefined();
  });

  it('no webhook-id header (or the legacy no-connection path) is unrecorded, not new or processed', async () => {
    const db = fakeDb();
    const noHeader = await claim(db, undefined);
    expect(noHeader).toEqual({ kind: 'unrecorded' });
    expect(rows).toHaveLength(0);

    const noConnection = await claim(db, 'wh-5', null);
    expect(noConnection).toEqual({ kind: 'unrecorded' });
    expect(rows).toHaveLength(0);
  });

  it('markDeliveryProcessed / markDeliveryFailed are no-ops for an unrecorded (empty) deliveryId', async () => {
    let called = false;
    const db = { update: () => { called = true; return { set: () => ({ where: async () => {} }) }; } };
    await markDeliveryProcessed(db as never, '');
    await markDeliveryFailed(db as never, '', new Error('x'));
    expect(called).toBe(false);
  });
});
