import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, getDb } from '../../db';
import { orders, shipmentTracking, auditLog, withOrgContext } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { verifyHmac } from '../../middlewares/verifyWebhook';
import { issueInvoice } from '../../services/eta';
import { buildEtaOrderInput } from '../../services/buildEtaOrderInput';

/**
 * NOTE FOR ANYONE TRYING TO UNDERSTAND BOSTA INTEGRATION: there are TWO live,
 * separately-registered Bosta webhooks in this codebase, at different URLs:
 *
 *   /api/webhooks/bosta   this file       maps Bosta's `state` to an ORDER
 *                                         status transition and fires ETA
 *                                         invoicing on delivery.
 *   /webhooks/bosta       bosta-webhook.ts updates courier_shipments (COD
 *                                         collection, courier status) and
 *                                         fires an outbox order.shipped
 *                                         event.
 *
 * They are not duplicates of each other — different tables, different
 * concerns — but which URL Bosta's dashboard is actually configured to call
 * is outside what this codebase can answer; that is a Bosta account
 * configuration question, not a code one. Found while wiring P5 (this file's
 * writes had no tenant scope at all, and its issueInvoice call predated real
 * invoice lines existing) — flagged rather than silently merged.
 */

const bostaRoute = new Hono();

bostaRoute.post('/', verifyHmac('BOSTA_WEBHOOK_SECRET', 'x-bosta-signature'), async (c: Context) => {
  const bodyRaw = c.get('rawBody') as string;

  const payload = JSON.parse(bodyRaw);
  const trackingNumber = payload.trackingNumber as string | undefined;
  const bostaState = payload.state as string | undefined;

  if (!trackingNumber) {
    return c.json({ data: null, error: 'missing_tracking_number', meta: null }, 400);
  }

  // A webhook carries no session — the tenant comes from the shipment row
  // itself, found by an unscoped lookup on the tracking number (which is
  // globally unique, not per-org). Every write that follows is then scoped
  // to THAT shipment's own org, via withOrgContext.
  const [shipment] = await db.select().from(shipmentTracking).where(eq(shipmentTracking.trackingNumber, trackingNumber));

  if (!shipment) {
    return c.json({ data: null, error: 'shipment_not_found', meta: null }, 404);
  }

  // Map Bosta state to Order state
  let newOrderStatus: 'shipped' | 'delivered' | 'cancelled' | null = null;
  if (bostaState === 'Picked up' || bostaState === 'In Transit') {
    newOrderStatus = 'shipped';
  } else if (bostaState === 'Delivered') {
    newOrderStatus = 'delivered';
  } else if (bostaState === 'Cancelled' || bostaState === 'Returned') {
    newOrderStatus = 'cancelled';
  }

  const updatedOrder = await withOrgContext(getDb(), shipment.orgId, async (tx) => {
    // Update shipment status — was an unscoped `db.update`, i.e. no org_id in
    // its own WHERE; RLS would have refused a cross-tenant write, but a query
    // should be correct on its own rather than rely on that backstop (the
    // same principle apps/admin/src/__tests__/tenancyGate.test.ts enforces
    // for every admin router write).
    await tx.update(shipmentTracking)
      .set({ status: bostaState, rawPayload: payload, updatedAt: new Date() })
      .where(and(eq(shipmentTracking.id, shipment.id), eq(shipmentTracking.orgId, shipment.orgId)));

    if (!newOrderStatus) return null;

    const [order] = await tx.select().from(orders)
      .where(and(eq(orders.id, shipment.orderId), eq(orders.orgId, shipment.orgId)));
    if (!order || order.status === newOrderStatus) return null;

    const [row] = await tx.update(orders)
      .set({ status: newOrderStatus, updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)))
      .returning();

    // userId: null throughout this file — a webhook has no authenticated
    // user, and audit_log.user_id is nullable for exactly this reason.
    await tx.insert(auditLog).values({
      orgId: order.orgId,
      userId: null,
      action: 'BOSTA_WEBHOOK_STATUS_UPDATE',
      tableName: 'orders',
      recordId: order.id,
      changes: { oldStatus: order.status, newStatus: newOrderStatus, bostaState },
    });

    return row;
  });

  if (updatedOrder?.status === 'delivered') {
    // Outside the transaction and fire-and-forget, same reasoning as the
    // identical call in apps/api/src/routes/orders.ts: issueInvoice makes
    // external HTTP calls, which must never hold a pooled connection open.
    buildEtaOrderInput(updatedOrder.orgId, updatedOrder.id, updatedOrder.orderNumber, updatedOrder.currency)
      .then((etaInput) => etaInput && issueInvoice(etaInput))
      .catch(e => console.error('issueInvoice failed:', e instanceof Error ? e.message : 'unknown error'));
  }

  return c.json({ data: { success: true }, error: null, meta: null });
});

export { bostaRoute };
