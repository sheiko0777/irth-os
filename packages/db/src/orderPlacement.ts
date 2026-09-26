import { and, eq, sql } from 'drizzle-orm';
import { orders, orderItems, type OrderAddressSnapshot, type OrderBuyerSnapshot } from './schema';
import { inventoryItems, inventoryMovements } from './schema/inventory';
import { formatDocumentNumber, nextDocumentNumber, withAudit, type DbTx } from './index';

/** Thrown inside the order transaction so the whole thing rolls back. */
export class InsufficientStockError extends Error {
  constructor(readonly variantId: string) {
    super(`Insufficient stock for variant ${variantId}`);
    this.name = 'InsufficientStockError';
  }
}

export interface PlaceOrderInput {
  orgId: string;
  /** Who is placing it, for the audit row (a Better Auth user id). */
  userId: string | null;
  lines: ReadonlyArray<{ variantId: string; quantity: number; priceMinor: bigint }>;
  currency: string;
  totalAmountMinor: bigint;
  paymentMethod: 'cod' | 'online';
  customerId?: string | null;
  /** 0078: the member who placed it in the dashboard. */
  createdByMemberId?: string | null;
  subtotalMinor?: bigint | null;
  discountMinor?: bigint | null;
  customerNote?: string | null;
  /** Snapshots at order time (0073), e.g. from the customer record. */
  buyer?: OrderBuyerSnapshot | null;
  shippingAddress?: OrderAddressSnapshot | null;
  auditChanges?: Record<string, unknown>;
}

/**
 * Places an order: its number, the stock leaving, the order, its lines and
 * the audit row — one transaction, the caller's. Shared by apps/api's
 * POST /orders and the sales rep's order (PR-2b), so there is one
 * implementation of "an order takes stock", not two that drift.
 *
 * Stock is taken in the UPDATE's WHERE (`quantity >= n`), so the check and the
 * decrement are one statement and two concurrent orders cannot both pass a
 * "5 in stock" read. Zero rows updated is a refusal: InsufficientStockError,
 * and the throw rolls the whole order back, number included.
 *
 * Each line's cost basis is captured as the stock leaves (0039) — the item's
 * current average, NULL when nothing with a known cost was ever received
 * (unknown, not free) — so the order-delivered posting can sum it later.
 */
export async function placeOrder(tx: DbTx, input: PlaceOrderInput) {
  const { orgId } = input;
  const seq = await nextDocumentNumber(tx, orgId, 'order');
  const orderNumber = formatDocumentNumber('order', seq);

  const lineCostsMinor: (bigint | null)[] = [];
  for (const item of input.lines) {
    const updated = await tx
      .update(inventoryItems)
      .set({
        quantity: sql`${inventoryItems.quantity} - ${item.quantity}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inventoryItems.orgId, orgId),
        eq(inventoryItems.variantId, item.variantId),
        sql`${inventoryItems.quantity} >= ${item.quantity}`,
      ))
      .returning({ id: inventoryItems.id, quantity: inventoryItems.quantity, averageCostMinor: inventoryItems.averageCostMinor });

    if (updated.length === 0) {
      throw new InsufficientStockError(item.variantId);
    }

    const avg = updated[0].averageCostMinor;
    const lineCostMinor = avg == null ? null : avg * BigInt(item.quantity);
    lineCostsMinor.push(lineCostMinor);

    await tx.insert(inventoryMovements).values({
      orgId,
      itemId: updated[0].id,
      type: 'out',
      quantity: item.quantity,
      costMinor: lineCostMinor,
      note: `Order ${orderNumber}`,
    });
  }

  return withAudit(tx, async () => {
    const [insertedOrder] = await tx.insert(orders).values({
      orgId,
      orderNumber,
      status: 'pending',
      paymentMethod: input.paymentMethod,
      totalAmountMinor: input.totalAmountMinor,
      currency: input.currency,
      // customers.id, never a Better Auth user id (0034).
      customerId: input.customerId ?? null,
      createdByMemberId: input.createdByMemberId ?? null,
      subtotalMinor: input.subtotalMinor ?? null,
      discountMinor: input.discountMinor ?? null,
      customerNote: input.customerNote ?? null,
      buyer: input.buyer ?? null,
      shippingAddress: input.shippingAddress ?? null,
    }).returning();

    if (input.lines.length > 0) {
      await tx.insert(orderItems).values(
        input.lines.map((item, i) => ({
          orgId,
          variantId: item.variantId,
          quantity: item.quantity,
          priceMinor: item.priceMinor,
          orderId: insertedOrder.id,
          // Index-aligned with the loop above, not keyed by variant: a variant
          // can appear as two lines with different quantities.
          costMinor: lineCostsMinor[i] ?? null,
        })),
      );
    }

    return insertedOrder;
  }, {
    orgId,
    userId: input.userId,
    action: 'CREATE',
    tableName: 'orders',
    changes: input.auditChanges ?? { items: input.lines },
  });
}
