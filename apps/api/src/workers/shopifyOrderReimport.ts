import {
  db, orders, orderItems, inventoryDiscrepancies, outboxEvents,
  withOrgContext, withAudit, emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS,
  type ShopifyOrderReimportPayload,
} from '@irth/db';
import { and, eq } from 'drizzle-orm';
import {
  applyShopifyOrderLines, blockedReasonFor, findUnmappedLines, notifyAdminsOfStockShortfall,
  type ShopifyOrderPayload,
} from '../services/shopifyOrderImport';

type OutboxEvent = typeof outboxEvents.$inferSelect;

export type ReimportOutcome = 'completed' | 'still_blocked' | 'not_blocked';

/**
 * Finishes the import of a blocked Shopify order (0073) once its lines map.
 *
 * Same line handling as the orders/create webhook (shared
 * applyShopifyOrderLines: stable lock order, floored stock, recorded
 * shortfall), run against the payload stored on the order when it was
 * blocked. Items, stock movements, the flip to 'complete', the audit row and
 * the customer notification all commit together.
 *
 * Idempotent: the order row is locked and must still be 'blocked'. A second
 * event for the same order finds it complete and does nothing. A cancelled
 * order is never re-imported — it would take stock for a sale that is off.
 */
export async function reimportBlockedShopifyOrder(
  database: typeof db,
  orgId: string,
  orderId: string,
): Promise<ReimportOutcome> {
  return withOrgContext(database, orgId, async (tx) => {
    const [order] = await tx.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId), eq(orders.importStatus, 'blocked')))
      .for('update');
    if (!order || !order.sourcePayload || order.status === 'cancelled') return 'not_blocked';

    const payload = order.sourcePayload as ShopifyOrderPayload;
    const unmapped = await findUnmappedLines(tx, orgId, payload);
    if (unmapped.length > 0) {
      await tx.update(orders)
        .set({ blockedReason: blockedReasonFor(unmapped), updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.orgId, orgId)));
      return 'still_blocked';
    }

    const { resolvedItems, discrepancies } = await applyShopifyOrderLines(tx, orgId, payload);

    await withAudit(tx, async () => {
      if (resolvedItems.length > 0) {
        await tx.insert(orderItems).values(resolvedItems.map((item) => ({
          orgId,
          orderId: order.id,
          variantId: item.variantId,
          quantity: item.quantity,
          priceMinor: item.priceMinor,
        })));
      }
      const [row] = await tx.update(orders)
        .set({ importStatus: 'complete', blockedReason: null, updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.orgId, orgId), eq(orders.importStatus, 'blocked')))
        .returning();
      return row;
    }, {
      orgId,
      userId: null,
      action: 'SHOPIFY_ORDER_REIMPORTED',
      tableName: 'orders',
      changes: { orderNumber: order.orderNumber, shopifyOrderId: order.shopifyOrderId, items: resolvedItems.length },
    });

    if (discrepancies.length > 0) {
      await tx.insert(inventoryDiscrepancies).values(discrepancies.map((d) => ({
        orgId,
        orderId: order.id,
        shopifyOrderId: order.shopifyOrderId,
        variantId: d.variantId,
        requestedQuantity: d.requestedQuantity,
        appliedQuantity: d.appliedQuantity,
        shortfallQuantity: d.shortfallQuantity,
        movementId: d.movementId,
      })));
      await notifyAdminsOfStockShortfall(tx, orgId, payload.name, discrepancies.length);
    }

    // The customer notification the webhook withheld while the order was
    // blocked — e.g. order.confirmed for a paid order.
    const eventType = OUTBOX_EVENT_BY_STATUS[order.status];
    if (eventType) {
      const notification = await buildOrderNotification(tx, orgId, order, eventType);
      if (notification) await emitOutboxEvent(tx, { orgId, eventType, payload: notification });
    }

    return 'completed';
  });
}

/** Outbox handler for `shopify.order.reimport`. */
export async function handleShopifyOrderReimport(database: typeof db, event: OutboxEvent): Promise<void> {
  const payload = JSON.parse(event.payload) as ShopifyOrderReimportPayload;
  await reimportBlockedShopifyOrder(database, event.orgId, payload.orderId);
  // Processed in every outcome. 'still_blocked' is not a failure to retry:
  // nothing changes until an operator maps another line, and that action
  // emits a fresh event.
  await database.update(outboxEvents)
    .set({ processed: true, processedAt: new Date() })
    .where(eq(outboxEvents.id, event.id));
}
