/**
 * DM-05 ⊕ OR-09 / migration 0086 (orders v2, PR A) against real Postgres:
 * an order with a source must come through an accepted candidate
 * (orders_promotion_guard_check); at COMMIT a promoted order must carry exactly
 * candidate.line_count items (orders_items_match_candidate, deferred); only a
 * custom_nonstock line may lack a variant; dashboard orders (source NULL) are
 * untouched; the provider child tables are tenant-isolated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  orderImportCandidates, orderItems, orderSourceTransactions, orders, organizations, products, productVariants,
  shopifyConnections, withOrgContext,
} from '@irth/db';
import { eq } from 'drizzle-orm';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let orgB: string;
let connA: string;
let variantA: string;
let seq = 0;

// drizzle wraps driver errors: the SQLSTATE is on err.cause, not err.
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

async function candidateWithLines(lineCount: number): Promise<{ id: string; sourceOrderId: string }> {
  const sourceOrderId = `gid://shopify/Order/guard-${++seq}`;
  const [row] = await testDb.insert(orderImportCandidates).values({
    orgId: orgA, connectionId: connA, sourceOrderId, sourceUpdatedAt: new Date('2026-10-01T10:00:00Z'), lineCount,
  }).returning();
  return { id: row.id, sourceOrderId };
}

function promotedHeader(candidateId: string, sourceOrderId: string) {
  return {
    orgId: orgA, orderNumber: `IRT-GUARD-${++seq}`, totalAmountMinor: 20000n,
    source: 'shopify', connectionId: connA, sourceOrderId, acceptedCandidateId: candidateId,
  };
}

const mappedLine = (orderId: string) => ({ orgId: orgA, orderId, variantId: variantA, quantity: 1, priceMinor: 10000n });
const customLine = (orderId: string) => ({
  orgId: orgA, orderId, variantId: null, lineKind: 'custom_nonstock' as const, title: 'Gift wrap', quantity: 1, priceMinor: 10000n,
});

beforeAll(async () => {
  await truncateAll();
  const stamp = Date.now();
  const [a] = await testDb.insert(organizations).values({ name: 'Guard A', slug: `guard-a-${stamp}` }).returning();
  const [b] = await testDb.insert(organizations).values({ name: 'Guard B', slug: `guard-b-${stamp}` }).returning();
  orgA = a.id;
  orgB = b.id;
  const [conn] = await testDb.insert(shopifyConnections).values({
    orgId: orgA, shopDomain: `guard-a-${stamp}.myshopify.com`, accessTokenCiphertext: 'test-only', accessTokenIv: 'test-only',
    scopes: 'read_orders', apiVersion: '2026-07', pixelIngestionKey: `test-only-${stamp}`,
  }).returning();
  connA = conn.id;
  const [product] = await testDb.insert(products).values({
    orgId: orgA, name: 'Widget', sku: `SKU-G-${stamp}`, priceMinor: 10000n, currency: 'EGP',
  }).returning();
  const [variant] = await testDb.insert(productVariants).values({
    orgId: orgA, productId: product.id, name: 'Default', sku: `V-G-${stamp}`, priceMinor: 10000n,
  }).returning();
  variantA = variant.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe('orders v2 promotion guard (0086)', () => {
  it("refuses source='shopify' without an accepted candidate", async () => {
    expect(await pgCode(testDb.insert(orders).values({
      orgId: orgA, orderNumber: `IRT-GUARD-${++seq}`, totalAmountMinor: 100n, source: 'shopify', sourceOrderId: 'gid://shopify/Order/no-cand',
    }))).toBe('23514');
  });

  it('refuses at COMMIT when the item count differs from candidate.line_count', async () => {
    const cand = await candidateWithLines(2);
    const header = promotedHeader(cand.id, cand.sourceOrderId);
    expect(await pgCode(withOrgContext(testDb, orgA, async (tx) => {
      const [order] = await tx.insert(orders).values(header).returning();
      await tx.insert(orderItems).values(mappedLine(order.id));
    }))).toBe('23514');
    // Nothing of the half-promoted order survived the rollback.
    const left = await testDb.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, header.orderNumber));
    expect(left).toEqual([]);
  });

  it("refuses an order_items row with no variant unless it is 'custom_nonstock'", async () => {
    const [order] = await testDb.insert(orders).values({ orgId: orgA, orderNumber: `IRT-GUARD-${++seq}`, totalAmountMinor: 100n }).returning();
    expect(await pgCode(testDb.insert(orderItems).values({ ...mappedLine(order.id), variantId: null }))).toBe('23514');
    // ...and a custom_nonstock line may not carry one either.
    expect(await pgCode(testDb.insert(orderItems).values({ ...customLine(order.id), variantId: variantA }))).toBe('23514');
  });

  it('commits a full promotion whose items match line_count, including a custom_nonstock line', async () => {
    const cand = await candidateWithLines(2);
    const orderId = await withOrgContext(testDb, orgA, async (tx) => {
      const [order] = await tx.insert(orders).values(promotedHeader(cand.id, cand.sourceOrderId)).returning();
      await tx.insert(orderItems).values([mappedLine(order.id), customLine(order.id)]);
      return order.id;
    });
    const items = await testDb.select({ variantId: orderItems.variantId, lineKind: orderItems.lineKind })
      .from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.lineKind === 'custom_nonstock')?.variantId).toBeNull();
  });

  it('leaves a dashboard order (source NULL) alone, with the lifecycle defaults', async () => {
    const [order] = await testDb.insert(orders).values({ orgId: orgA, orderNumber: `IRT-GUARD-${++seq}`, totalAmountMinor: 100n }).returning();
    expect(order.source).toBeNull();
    expect([order.commercialStatus, order.fulfillmentStatus, order.paymentStatus, order.invoiceStatus, order.settlementStatus])
      .toEqual(['open', 'unfulfilled', 'pending', 'not_required', 'unsettled']);
    expect(order.isTest).toBe(false);
  });

  it("isolates order_source_transactions: org B neither reads nor writes org A's", async () => {
    const [order] = await testDb.insert(orders).values({ orgId: orgA, orderNumber: `IRT-GUARD-${++seq}`, totalAmountMinor: 100n }).returning();
    await withOrgContext(testDb, orgA, (tx) => tx.insert(orderSourceTransactions).values({
      orgId: orgA, orderId: order.id, sourceId: 'gid://shopify/OrderTransaction/1', kind: 'sale', amountMinor: 100n, currency: 'EGP',
    }));
    const seen = await withOrgContext(testDb, orgB, (tx) => tx.select({ id: orderSourceTransactions.id }).from(orderSourceTransactions));
    expect(seen).toEqual([]);
    await expect(withOrgContext(testDb, orgB, (tx) => tx.insert(orderSourceTransactions).values({
      orgId: orgA, orderId: order.id, sourceId: 'gid://shopify/OrderTransaction/2',
    }))).rejects.toBeTruthy();
    // An org B row cannot point at org A's order either (same-org composite FK).
    expect(await pgCode(withOrgContext(testDb, orgB, (tx) => tx.insert(orderSourceTransactions).values({
      orgId: orgB, orderId: order.id, sourceId: 'gid://shopify/OrderTransaction/3',
    })))).toBe('23503');
  });
});
