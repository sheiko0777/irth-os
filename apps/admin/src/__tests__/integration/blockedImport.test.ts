/**
 * 0073: an imported order is complete or visibly blocked — never partial.
 *
 * Against real Postgres because every guarantee here is database behaviour:
 * the CHECK on import_status, the WHERE-clause guard in transitionOrderStatus,
 * the one-to-one Shopify-variant link guarded in the UPDATE, and the
 * idempotency of the re-import (row lock + 'blocked' predicate).
 *
 * The re-import job lives in apps/api (outbox event `shopify.order.reimport`).
 * It is imported here by path because it only depends on @irth/db and
 * drizzle, and a mirror of it would prove the pattern, not the shipped code.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  inventoryItems, orderItems, orders, organizations, outboxEvents, products, productVariants,
  transitionOrderStatus, withOrgContext,
} from '@irth/db';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';
import { reimportBlockedShopifyOrder } from '../../../../api/src/workers/shopifyOrderReimport';

vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { ordersRouter } = await import('@/server/routers/orders');
const { bulkRouter } = await import('@/server/routers/bulk');

let orgId: string;
let linkedVariantId: string;
let unlinkedVariantId: string;
let sequence = 0;

const LINKED_GID = 'gid://shopify/ProductVariant/1001';
const UNLINKED_GID = 'gid://shopify/ProductVariant/2002';

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Blocked import', slug: `blocked-import-${Date.now()}` }).returning();
  orgId = org.id;

  const [product] = await testDb.insert(products).values({
    orgId, name: 'Serum', sku: `SERUM-${Date.now()}`, priceMinor: 25000n, currency: 'EGP',
  }).returning();
  const [linked] = await testDb.insert(productVariants).values({
    orgId, productId: product.id, name: '30ml', sku: `SERUM-30-${Date.now()}`, priceMinor: 25000n, shopifyVariantId: LINKED_GID,
  }).returning();
  const [unlinked] = await testDb.insert(productVariants).values({
    orgId, productId: product.id, name: '50ml', sku: `SERUM-50-${Date.now()}`, priceMinor: 40000n,
  }).returning();
  linkedVariantId = linked.id;
  unlinkedVariantId = unlinked.id;
  await testDb.insert(inventoryItems).values([
    { orgId, variantId: linkedVariantId, quantity: 10 },
    { orgId, variantId: unlinkedVariantId, quantity: 10 },
  ]);
});
afterAll(async () => { await closeTestDb(); });

function ctx() {
  return {
    db: testDb, orgId, userId: 'ops-user', role: 'owner',
    session: { user: { id: 'ops-user', email: 'ops@test.com' } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context;
}

function caller() {
  return ordersRouter.createCaller({
    db: testDb, orgId, userId: 'ops-user', role: 'owner',
    session: { user: { id: 'ops-user', email: 'ops@test.com' } },
    withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
  } as unknown as Context);
}

/** What the orders/create webhook writes when a line has no local variant. */
async function blockedOrder(status: 'pending' | 'confirmed' = 'confirmed') {
  const n = ++sequence;
  const [order] = await testDb.insert(orders).values({
    orgId,
    orderNumber: `BLK-${n}`,
    status,
    totalAmountMinor: 170000n,
    currency: 'EGP',
    shopifyOrderId: `gid://shopify/Order/${9000 + n}`,
    importStatus: 'blocked',
    blockedReason: 'بنود غير مربوطة بمنتج في النظام: Serum 50ml',
    buyer: { name: 'Mona', email: 'mona@example.com', phone: '+201000000000' },
    sourcePayload: {
      id: 9000 + n,
      name: `#${1000 + n}`,
      line_items: [
        { variant_id: 1001, sku: 'S30', name: 'Serum 30ml', quantity: 2, price: '250.00' },
        { variant_id: 2002, sku: 'S50', name: 'Serum 50ml', quantity: 3, price: '400.00' },
      ],
    },
  }).returning();
  return order;
}

async function quantityOf(variantId: string) {
  const [row] = await testDb.select({ quantity: inventoryItems.quantity }).from(inventoryItems)
    .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, variantId)));
  return row.quantity;
}

describe('orders.import_status', () => {
  it('rejects a value outside complete|blocked', async () => {
    await expect(testDb.execute(sql`
      INSERT INTO orders (org_id, order_number, status, total_amount_minor, currency, import_status)
      VALUES (${orgId}, 'BAD-1', 'pending', 100, 'EGP', 'partial')
    `)).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
  });

  it('defaults to complete for orders created without it', async () => {
    const [row] = await testDb.insert(orders).values({
      orgId, orderNumber: `DASH-${++sequence}`, status: 'pending', totalAmountMinor: 100n, currency: 'EGP',
    }).returning();
    expect(row.importStatus).toBe('complete');
  });
});

describe('a blocked order cannot advance', () => {
  it.each(['confirmed', 'shipped', 'delivered'])('transitionOrderStatus refuses %s', async (next) => {
    const order = await blockedOrder('pending');
    const result = await withOrgContext(testDb, orgId, (tx) =>
      transitionOrderStatus(tx, { orgId, orderId: order.id, newStatus: next }));
    expect(result).toBeNull();
    const [row] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('pending');
  });

  it('can still be cancelled', async () => {
    const order = await blockedOrder('pending');
    const result = await withOrgContext(testDb, orgId, (tx) =>
      transitionOrderStatus(tx, { orgId, orderId: order.id, newStatus: 'cancelled' }));
    expect(result).toEqual({ previousStatus: 'pending' });
  });

  it('bulk status change skips blocked orders and moves the rest', async () => {
    const blocked = await blockedOrder();
    const [complete] = await testDb.insert(orders).values({
      orgId, orderNumber: `OK-${++sequence}`, status: 'confirmed', totalAmountMinor: 100n, currency: 'EGP',
    }).returning();
    await bulkRouter.createCaller(ctx()).bulkUpdateOrderStatus({ ids: [blocked.id, complete.id], status: 'shipped' });
    const rows = await testDb.select({ id: orders.id, status: orders.status }).from(orders)
      .where(and(eq(orders.orgId, orgId), sql`${orders.id} IN (${blocked.id}, ${complete.id})`));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [blocked.id]: 'confirmed', [complete.id]: 'shipped' });
  });

  it('the admin router explains why instead of saying not found', async () => {
    const order = await blockedOrder();
    await expect(caller().updateStatus({ id: order.id, status: 'shipped' }))
      .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('the order page shows every line as received', () => {
  it('returns source lines with their mapping state and hides the raw payload', async () => {
    const order = await blockedOrder();
    const { data } = await caller().getById({ id: order.id });
    expect(data.order.sourcePayload).toBeUndefined();
    expect(data.order.buyer).toEqual({ name: 'Mona', email: 'mona@example.com', phone: '+201000000000' });
    expect(data.sourceLines).toEqual([
      expect.objectContaining({ label: 'Serum 30ml', quantity: 2, unitPriceMinor: 25000n, mappedVariant: expect.objectContaining({ id: linkedVariantId }) }),
      expect.objectContaining({ label: 'Serum 50ml', quantity: 3, unitPriceMinor: 40000n, shopifyVariantId: UNLINKED_GID, mappedVariant: null }),
    ]);
  });

  it('lists blocked orders and counts them', async () => {
    const { data, meta } = await caller().list({ page: 1, pageSize: 50, blockedOnly: true });
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((o) => o.importStatus === 'blocked')).toBe(true);
    expect(meta.blockedCount).toBeGreaterThanOrEqual(data.length);
  });
});

describe('resolving a blocked order', () => {
  it('refuses to re-point a variant already linked to another Shopify variant', async () => {
    const order = await blockedOrder();
    await expect(caller().resolveBlocked({
      orderId: order.id,
      mappings: [{ shopifyVariantId: UNLINKED_GID, variantId: linkedVariantId }],
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    const [variant] = await testDb.select().from(productVariants).where(eq(productVariants.id, linkedVariantId));
    expect(variant.shopifyVariantId).toBe(LINKED_GID);
  });

  it('links the line, queues the re-import, and the re-import completes the order exactly once', async () => {
    const order = await blockedOrder();
    const before = { linked: await quantityOf(linkedVariantId), unlinked: await quantityOf(unlinkedVariantId) };

    // Before mapping: the job leaves it blocked and moves no stock.
    expect(await reimportBlockedShopifyOrder(testDb, orgId, order.id)).toBe('still_blocked');
    expect(await quantityOf(linkedVariantId)).toBe(before.linked);

    const res = await caller().resolveBlocked({
      orderId: order.id,
      mappings: [{ shopifyVariantId: UNLINKED_GID, variantId: unlinkedVariantId }],
    });
    expect(res.data).toEqual({ id: order.id, queued: true });
    const queued = await testDb.select().from(outboxEvents)
      .where(and(eq(outboxEvents.orgId, orgId), eq(outboxEvents.eventType, 'shopify.order.reimport')));
    expect(queued.some((e) => JSON.parse(e.payload).orderId === order.id)).toBe(true);

    const [first, second] = await Promise.all([
      reimportBlockedShopifyOrder(testDb, orgId, order.id),
      reimportBlockedShopifyOrder(testDb, orgId, order.id),
    ]);
    expect([first, second].sort()).toEqual(['completed', 'not_blocked']);

    const [row] = await testDb.select().from(orders).where(eq(orders.id, order.id));
    expect(row.importStatus).toBe('complete');
    expect(row.blockedReason).toBeNull();
    const items = await testDb.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items).toHaveLength(2);
    expect(await quantityOf(linkedVariantId)).toBe(before.linked - 2);
    expect(await quantityOf(unlinkedVariantId)).toBe(before.unlinked - 3);

    // Now complete, it advances like any other order.
    const moved = await withOrgContext(testDb, orgId, (tx) =>
      transitionOrderStatus(tx, { orgId, orderId: order.id, newStatus: 'shipped' }));
    expect(moved).toEqual({ previousStatus: 'confirmed' });
  });

  it('never re-imports a cancelled order', async () => {
    const order = await blockedOrder();
    await testDb.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, order.id));
    const before = await quantityOf(linkedVariantId);
    expect(await reimportBlockedShopifyOrder(testDb, orgId, order.id)).toBe('not_blocked');
    expect(await quantityOf(linkedVariantId)).toBe(before);
  });
});
