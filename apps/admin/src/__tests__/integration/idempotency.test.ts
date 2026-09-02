/**
 * withIdempotency and the stock guard, against real Postgres.
 *
 * Both are concurrency properties, so a mock can say nothing about either: the
 * unique index, the row lock and the WHERE-clause guard are database
 * behaviour, not application logic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  IdempotencyError,
  fingerprint,
  inventoryItems,
  inventoryDiscrepancies,
  orders,
  organizations,
  productVariants,
  products,
  withIdempotency,
  withOrgContext,
} from '@irth/db';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

let orgA: string;
let variantId: string;

beforeAll(async () => {
  await truncateAll();

  const [a] = await testDb.insert(organizations)
    .values({ name: 'Idem Org', slug: `idem-${Date.now()}` }).returning();
  orgA = a.id;

  const [product] = await testDb.insert(products).values({
    orgId: orgA, name: 'Widget', sku: `SKU-${Date.now()}`, priceMinor: 1000n, currency: 'EGP',
  }).returning();

  const [variant] = await testDb.insert(productVariants).values({
    orgId: orgA, productId: product.id, name: 'Default', sku: `V-${Date.now()}`, priceMinor: 1000n,
  }).returning();
  variantId = variant.id;

  await testDb.insert(inventoryItems).values({ orgId: orgA, variantId, quantity: 5 });
});

afterAll(async () => {
  await closeTestDb();
});

describe('withIdempotency', () => {
  it('runs the operation once and replays the stored response', async () => {
    let ran = 0;
    const op = () => { ran++; return Promise.resolve({ orderId: 'abc', total: 100 }); };

    const first = await withIdempotency(
      testDb, { orgId: orgA, operation: 'test.create', key: 'k1', request: { a: 1 } }, op);
    const second = await withIdempotency(
      testDb, { orgId: orgA, operation: 'test.create', key: 'k1', request: { a: 1 } }, op);

    expect(ran).toBe(1);                 // the whole point
    expect(second).toEqual(first);
  });

  it('rejects the same key used for a different request', async () => {
    // Replaying the first response here would silently discard what the second
    // request actually asked for. Reported, not guessed at.
    await withIdempotency(
      testDb, { orgId: orgA, operation: 'test.create', key: 'k2', request: { a: 1 } },
      async () => ({ ok: true }));

    await expect(
      withIdempotency(
        testDb, { orgId: orgA, operation: 'test.create', key: 'k2', request: { a: 999 } },
        async () => ({ ok: true })),
    ).rejects.toBeInstanceOf(IdempotencyError);
  });

  it('scopes keys per tenant and per operation', async () => {
    // The same key string under a different operation is a different intent,
    // not a retry.
    let ran = 0;
    const op = () => { ran++; return Promise.resolve({ n: ran }); };

    await withIdempotency(
      testDb, { orgId: orgA, operation: 'op.one', key: 'shared', request: {} }, op);
    await withIdempotency(
      testDb, { orgId: orgA, operation: 'op.two', key: 'shared', request: {} }, op);

    expect(ran).toBe(2);
  });

  it('releases the key when the operation throws, so a genuine retry works', async () => {
    let attempts = 0;
    const flaky = () => {
      attempts++;
      if (attempts === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve({ ok: true });
    };

    await expect(
      withIdempotency(
        testDb, { orgId: orgA, operation: 'test.flaky', key: 'k3', request: {} }, flaky),
    ).rejects.toThrow('transient');

    // A failed attempt must not permanently poison the key.
    const retry = await withIdempotency(
      testDb, { orgId: orgA, operation: 'test.flaky', key: 'k3', request: {} }, flaky);

    expect(retry).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('runs every time when no key is supplied', async () => {
    // Opt-in: without a key there is no bookkeeping and no behaviour change,
    // which is what lets existing callers keep working.
    let ran = 0;
    const op = () => { ran++; return Promise.resolve(ran); };

    await withIdempotency(
      testDb, { orgId: orgA, operation: 'test.nokey', key: undefined, request: {} }, op);
    await withIdempotency(
      testDb, { orgId: orgA, operation: 'test.nokey', key: undefined, request: {} }, op);

    expect(ran).toBe(2);
  });

  it('rejects retries that arrive WHILE the first attempt is still running', async () => {
    // The case that motivates the whole design: a client times out precisely
    // because the server is slow, then retries while the first attempt is still
    // in flight. Claiming the key BEFORE the work is what makes that retry
    // collide immediately instead of duplicating it.
    //
    // Gated rather than timed. The first version slept 150ms inside the
    // operation and raced that against the round trip to Neon — which is the
    // same order of magnitude, so the retries landed AFTER the first had
    // already completed and all five happily replayed. It passed for the wrong
    // reason and proved nothing about the in_progress path. An explicit latch
    // makes the window deterministic.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    let ran = 0;
    const gated = async () => { ran++; await gate; return { ok: true }; };

    const args = { orgId: orgA, operation: 'test.race', key: 'race-1', request: {} };

    // Starts, claims the key, and parks inside the operation.
    const first = withIdempotency(testDb, args, gated);
    // Let the claim commit before the retries look for it.
    await new Promise((r) => setTimeout(r, 400));

    const retries = await Promise.allSettled(
      Array.from({ length: 4 }, () => withIdempotency(testDb, args, gated)),
    );

    // Every retry refused while the original was still running.
    expect(retries.every((r) => r.status === 'rejected')).toBe(true);
    expect(
      retries.every((r) =>
        (r as PromiseRejectedResult).reason instanceof IdempotencyError
        && /in progress/i.test((r as PromiseRejectedResult).reason.message)),
    ).toBe(true);
    // None of them entered the operation.
    expect(ran).toBe(1);

    release();
    await expect(first).resolves.toEqual({ ok: true });

    // And once it HAS completed, a later retry replays instead of refusing.
    const late = await withIdempotency(testDb, args, gated);
    expect(late).toEqual({ ok: true });
    expect(ran).toBe(1);
  });
});

describe('fingerprint', () => {
  it('ignores object key order', () => {
    // JSON.stringify preserves insertion order, so hashing it directly would
    // call a retry a mismatch depending on how the client built the object.
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it('distinguishes different values', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint({ items: [1, 2] })).not.toBe(fingerprint({ items: [2, 1] }));
  });

  it('handles bigint, which JSON.stringify throws on', () => {
    expect(() => fingerprint({ totalMinor: 100n })).not.toThrow();
    expect(fingerprint({ totalMinor: 100n })).toBe(fingerprint({ totalMinor: 100n }));
  });
});

describe('stock guard', () => {
  const takeStock = (qty: number) =>
    withOrgContext(testDb, orgA, async (tx) => {
      const updated = await tx
        .update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} - ${qty}` })
        .where(and(
          eq(inventoryItems.orgId, orgA),
          eq(inventoryItems.variantId, variantId),
          sql`${inventoryItems.quantity} >= ${qty}`,
        ))
        .returning({ quantity: inventoryItems.quantity });
      if (updated.length === 0) throw new Error('insufficient_stock');
      return updated[0].quantity;
    });

  it('refuses to take more than is on hand', async () => {
    // 5 in stock.
    await expect(takeStock(6)).rejects.toThrow('insufficient_stock');
  });

  it('never oversells under concurrency', async () => {
    // Five buyers, two units each, five on hand. A read-then-write guard lets
    // several pass the same "5 available" check and go negative — which is
    // exactly what having no decrement at all amounted to.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => takeStock(2)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(2); // 2 + 2 = 4 of 5; the third cannot be satisfied

    const [row] = await testDb.select().from(inventoryItems)
      .where(eq(inventoryItems.variantId, variantId));

    expect(row.quantity).toBe(1);
    // The assertion that matters: stock never goes below zero.
    expect(row.quantity).toBeGreaterThanOrEqual(0);
  });
});

/**
 * The Shopify webhook variant of the guard above
 * (apps/api/src/routes/webhooks/shopify.ts's orders/create handler): the
 * sale already happened on Shopify's side, so a shortfall cannot reject the
 * way `takeStock` above does — it must apply what's on hand, floor at zero,
 * and record the shortfall. Own fixtures (a fresh variant + a real order row
 * for inventory_discrepancies' FK) rather than reusing `variantId`, which
 * the concurrency test above has already partially consumed.
 */
describe('stock guard — Shopify shortfall (applies available instead of rejecting)', () => {
  let shortfallVariantId: string;
  let orderId: string;

  beforeAll(async () => {
    const [product] = await testDb.insert(products).values({
      orgId: orgA, name: 'Shortfall Widget', sku: `SF-SKU-${Date.now()}`, priceMinor: 1000n, currency: 'EGP',
    }).returning();
    const [variant] = await testDb.insert(productVariants).values({
      orgId: orgA, productId: product.id, name: 'Default', sku: `SF-V-${Date.now()}`, priceMinor: 1000n,
    }).returning();
    shortfallVariantId = variant.id;
    await testDb.insert(inventoryItems).values({ orgId: orgA, variantId: shortfallVariantId, quantity: 5 });

    const [order] = await testDb.insert(orders).values({
      orgId: orgA, orderNumber: `SF-ORDER-${Date.now()}`, totalAmountMinor: 1000n, status: 'confirmed',
    }).returning();
    orderId = order.id;
  });

  const takeStockOrRecordShortfall = (qty: number) =>
    withOrgContext(testDb, orgA, async (tx) => {
      const guarded = await tx.update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} - ${qty}` })
        .where(and(
          eq(inventoryItems.orgId, orgA),
          eq(inventoryItems.variantId, shortfallVariantId),
          sql`${inventoryItems.quantity} >= ${qty}`,
        ))
        .returning({ quantity: inventoryItems.quantity });
      if (guarded.length > 0) return { applied: qty, shortfall: 0 };

      // FOR UPDATE, mirroring the production path this helper stands in for
      // (apps/api/src/routes/webhooks/shopify.ts). Without it this is a read,
      // a decision, then a write, and the UPDATE below cannot carry a
      // `quantity >=` guard because it deliberately takes less than was asked
      // for — so two callers both read the same quantity and both subtract it.
      // This assertion had been passing by luck; on a contended database it
      // ended at -1, which is what surfaced the same bug in production.
      const [item] = await tx.select({ quantity: inventoryItems.quantity }).from(inventoryItems)
        .where(and(eq(inventoryItems.orgId, orgA), eq(inventoryItems.variantId, shortfallVariantId)))
        .for('update');
      const applied = item ? Math.max(0, Math.min(item.quantity, qty)) : 0;
      if (applied > 0) {
        await tx.update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} - ${applied}` })
          .where(eq(inventoryItems.variantId, shortfallVariantId));
      }
      await tx.insert(inventoryDiscrepancies).values({
        orgId: orgA, orderId, variantId: shortfallVariantId,
        requestedQuantity: qty, appliedQuantity: applied, shortfallQuantity: qty - applied,
      });
      return { applied, shortfall: qty - applied };
    });

  it('never goes negative under concurrency, and every unit is accounted for', async () => {
    // Five "webhook deliveries" each requesting 2 units against 5 on hand —
    // same shape as the concurrency test above, but nothing here is allowed
    // to throw/reject; every call must resolve.
    const results = await Promise.all(Array.from({ length: 5 }, () => takeStockOrRecordShortfall(2)));

    const [row] = await testDb.select().from(inventoryItems)
      .where(eq(inventoryItems.variantId, shortfallVariantId));
    expect(row.quantity).toBeGreaterThanOrEqual(0);
    expect(row.quantity).toBe(0); // 5 on hand, 10 requested — all consumed, none negative

    const totalApplied = results.reduce((sum, r) => sum + r.applied, 0);
    const totalShortfall = results.reduce((sum, r) => sum + r.shortfall, 0);
    expect(totalApplied + totalShortfall).toBe(10); // 5 callers x 2 requested each
    expect(totalApplied).toBe(5); // exactly what was on hand

    const discrepancyRows = await testDb.select().from(inventoryDiscrepancies)
      .where(eq(inventoryDiscrepancies.orderId, orderId));
    // Every caller that could not be fully satisfied produced a discrepancy
    // row — including a caller satisfied for 0 of 2 once stock hit zero.
    const shortfallCallers = results.filter((r) => r.shortfall > 0).length;
    expect(discrepancyRows).toHaveLength(shortfallCallers);
    expect(discrepancyRows.reduce((sum, d) => sum + d.shortfallQuantity, 0)).toBe(totalShortfall);
  });
});
