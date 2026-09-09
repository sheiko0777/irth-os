import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ACCOUNT_CODES, accounts, inventoryItems, inventoryMovements, journalEntries, journalLines,
  orders, orderItems, orderReturns, returnItems, organizations, products, productVariants,
  withOrgContext,
} from '@irth/db';
import type { Context } from '@/server/trpc';
import { closeTestDb, testDb, truncateAll } from './helpers/testDb';

// Only the Next request/session boundary is stubbed; all database work is real.
vi.mock('@/lib/auth', () => ({ verifySession: vi.fn() }));
const { returnsRouter } = await import('@/server/routers/returns');

let orgId: string;
let returnId: string;
let itemId: string;
let inventoryId: string;

beforeAll(async () => {
  await truncateAll();
  const [org] = await testDb.insert(organizations)
    .values({ name: 'Return race', slug: `return-race-${Date.now()}` }).returning();
  orgId = org.id;
  const [product] = await testDb.insert(products).values({
    orgId, name: 'Widget', sku: 'RETURN-P', priceMinor: 1000n, currency: 'EGP',
  }).returning();
  const [variant] = await testDb.insert(productVariants).values({
    orgId, productId: product.id, name: 'Default', sku: 'RETURN-V', priceMinor: 1000n,
  }).returning();
  const [inventory] = await testDb.insert(inventoryItems)
    .values({ orgId, variantId: variant.id, quantity: 5 }).returning();
  inventoryId = inventory.id;
  const [order] = await testDb.insert(orders).values({
    orgId, orderNumber: 'RETURN-ORDER', status: 'delivered', totalAmountMinor: 2000n, currency: 'EGP',
  }).returning();
  const [orderItem] = await testDb.insert(orderItems).values({
    orgId, orderId: order.id, variantId: variant.id, quantity: 2, priceMinor: 1000n, costMinor: 300n,
  }).returning();
  const [returned] = await testDb.insert(orderReturns).values({
    orgId, orderId: order.id, returnNumber: 'RMA-RACE', reason: 'other',
  }).returning();
  returnId = returned.id;
  const [item] = await testDb.insert(returnItems).values({
    orgId, returnId, orderItemId: orderItem.id, productName: product.name,
    variantName: variant.name, quantity: 2, unitPriceMinor: 1000n, condition: 'good',
  }).returning();
  itemId = item.id;
});

afterAll(async () => { await closeTestDb(); });

describe('return restock - concurrent router calls', () => {
  it('claims once, increments stock once and reverses cost once', async () => {
    const caller = returnsRouter.createCaller({
      db: testDb, orgId, userId: 'return-race-user', role: 'owner',
      session: { user: { id: 'return-race-user', email: 'returns@test.com' } },
      withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
    } as unknown as Context);
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      caller.restock({ returnId, itemId }),
    ));
    expect(results.filter(({ data }) => data.restocked)).toHaveLength(1);
    const retries = results.filter(({ data }) => !data.restocked);
    expect(retries).toHaveLength(9);
    for (const { data } of retries) {
      expect(data).toEqual({ restocked: false, alreadyRestocked: true });
    }
    const [inventory] = await testDb.select().from(inventoryItems)
      .where(and(eq(inventoryItems.id, inventoryId), eq(inventoryItems.orgId, orgId)));
    expect(inventory.quantity).toBe(7);
    const movements = await testDb.select().from(inventoryMovements)
      .where(and(eq(inventoryMovements.itemId, inventoryId), eq(inventoryMovements.orgId, orgId)));
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(2);
    const entries = await testDb.select().from(journalEntries).where(and(
      eq(journalEntries.orgId, orgId), eq(journalEntries.sourceTable, 'return_items'),
      eq(journalEntries.sourceId, itemId),
    ));
    expect(entries).toHaveLength(1);
    const lines = await testDb.select({
      code: accounts.code, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor,
    }).from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(and(eq(journalLines.entryId, entries[0].id), eq(journalLines.orgId, orgId), eq(accounts.orgId, orgId)));
    expect(lines).toHaveLength(2);
    expect(lines.filter(line => line.code === ACCOUNT_CODES.INVENTORY))
      .toEqual([{ code: ACCOUNT_CODES.INVENTORY, debitMinor: 600n, creditMinor: 0n }]);
    expect(lines.filter(line => line.code === ACCOUNT_CODES.COGS))
      .toEqual([{ code: ACCOUNT_CODES.COGS, debitMinor: 0n, creditMinor: 600n }]);
  });
});


describe('return restock - linkage failures', () => {
  it.each(['no_inventory_item', 'no_order_item_link'] as const)(
    '%s leaves the item unclaimed without a ledger entry and permits retry', async (reason) => {
      const [parent] = await testDb.select().from(orderReturns)
        .where(and(eq(orderReturns.id, returnId), eq(orderReturns.orgId, orgId)));
      const [product] = await testDb.insert(products).values({
        orgId, name: reason, sku: reason, priceMinor: 1000n, currency: 'EGP',
      }).returning();
      const [variant] = await testDb.insert(productVariants).values({
        orgId, productId: product.id, name: 'Default', sku: reason, priceMinor: 1000n,
      }).returning();
      const [line] = await testDb.insert(orderItems).values({
        orgId, orderId: parent.orderId, variantId: variant.id,
        quantity: 2, priceMinor: 1000n, costMinor: 300n,
      }).returning();
      const [item] = await testDb.insert(returnItems).values({
        orgId, returnId, orderItemId: reason === 'no_order_item_link' ? null : line.id,
        productName: product.name, variantName: variant.name, quantity: 2,
        unitPriceMinor: 1000n, condition: 'good', restock: false,
      }).returning();
      const caller = returnsRouter.createCaller({
        db: testDb, orgId, userId: 'return-race-user', role: 'owner',
        session: { user: { id: 'return-race-user', email: 'returns@test.com' } },
        withOrg: <T>(fn: Parameters<typeof withOrgContext<T>>[2]) => withOrgContext(testDb, orgId, fn),
      } as unknown as Context);
      const readItem = () => testDb.select().from(returnItems)
        .where(and(eq(returnItems.id, item.id), eq(returnItems.orgId, orgId)));
      const readEntries = () => testDb.select().from(journalEntries).where(and(
        eq(journalEntries.orgId, orgId), eq(journalEntries.sourceTable, 'return_items'),
        eq(journalEntries.sourceId, item.id),
      ));

      expect((await caller.restock({ returnId, itemId: item.id })).data)
        .toEqual({ restocked: false, reason });
      expect((await readItem())[0].restock).toBe(false);
      expect(await readEntries()).toHaveLength(0);

      // Repair the missing links, then retry the very same return item.
      if (reason === 'no_order_item_link') await testDb.update(returnItems).set({ orderItemId: line.id })
        .where(and(eq(returnItems.id, item.id), eq(returnItems.orgId, orgId)));
      const [inventory] = await testDb.insert(inventoryItems)
        .values({ orgId, variantId: variant.id, quantity: 5 }).returning();
      expect((await caller.restock({ returnId, itemId: item.id })).data)
        .toEqual({ restocked: true, reason: null });
      expect((await readItem())[0].restock).toBe(true);
      expect(await readEntries()).toHaveLength(1);
      const [updatedInventory] = await testDb.select().from(inventoryItems)
        .where(and(eq(inventoryItems.id, inventory.id), eq(inventoryItems.orgId, orgId)));
      expect(updatedInventory.quantity).toBe(7);
      const movements = await testDb.select().from(inventoryMovements)
        .where(and(eq(inventoryMovements.itemId, inventory.id), eq(inventoryMovements.orgId, orgId)));
      expect(movements).toHaveLength(1);
      expect(movements[0].quantity).toBe(2);
    },
  );
});
