import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, getDb } from '../../db';
import { courierShipments, orders, withOrgContext, emitOutboxEvent, buildOrderNotification } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { envVar } from '../../utils/env';

/**
 * Courier states that mean "the parcel is moving" — the natural trigger for
 * telling the customer their order shipped.
 *
 * `delivered` is NOT here. The worker has no branch for it, so an event would
 * be polled, match nothing, and be marked processed having sent nothing —
 * indistinguishable from a successful send on the Integrations screen.
 * `returned` is not a customer notification either.
 */
const SHIPPED_STATUSES = new Set(['picked_up', 'in_transit']);

export const aramexWebhookRoute = new Hono();

aramexWebhookRoute.post('/', async (c: Context) => {
  // Request-time read through the captured Worker env — see utils/env.ts.
  const token = envVar('ARAMEX_WEBHOOK_TOKEN');
  if (!token) {
    return c.json({ data: null, error: 'webhook_token_not_configured', meta: null }, 500);
  }

  const headerToken = c.req.header('X-Aramex-Token');
  if (!headerToken) {
    return c.json({ data: null, error: 'missing_token', meta: null }, 401);
  }

  const hashedHeaderToken = createHash('sha256').update(Buffer.from(headerToken)).digest();
  const hashedToken = createHash('sha256').update(Buffer.from(token)).digest();

  if (!timingSafeEqual(hashedHeaderToken, hashedToken)) {
    return c.json({ data: null, error: 'invalid_token', meta: null }, 401);
  }

  let payload;
  try {
    payload = await c.req.json();
  } catch (e) {
    return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  }

  // Parse Aramex event: { ShipmentTrackingNumber, UpdateCode, UpdateDescription, WaybillNumber }
  const trackingNumber = payload.WaybillNumber || payload.ShipmentTrackingNumber;
  const updateCode = payload.UpdateCode;

  if (!trackingNumber) {
    return c.json({ data: null, error: 'missing_tracking_number', meta: null }, 400);
  }

  // Map Aramex UpdateCodes: SH005→delivered, SH006→returned, SH001→picked_up, SH002→in_transit
  let courierStatus = 'created';
  if (updateCode === 'SH005') courierStatus = 'delivered';
  else if (updateCode === 'SH006') courierStatus = 'returned';
  else if (updateCode === 'SH001') courierStatus = 'picked_up';
  else if (updateCode === 'SH002') courierStatus = 'in_transit';

  const [existingShipment] = await db
    .select()
    .from(courierShipments)
    .where(eq(courierShipments.trackingNumber, trackingNumber));

  if (existingShipment) {
    const updatedEvents = [...(existingShipment.webhookEvents || []), payload];

    // Tenant from the shipment row: a webhook carries no session.
    await withOrgContext(getDb(), existingShipment.orgId, async (tx) => {
      await tx.update(courierShipments)
        .set({
          courierStatus,
          webhookEvents: updatedEvents,
          updatedAt: new Date()
        })
        .where(and(
          eq(courierShipments.id, existingShipment.id),
          eq(courierShipments.orgId, existingShipment.orgId),
        ));

      // The courier telling us a parcel is moving is the natural order.shipped
      // trigger, and PROJECT_MASTER_PLAN.md:368 specifies an outbox insert
      // here. Nothing wrote one, so a parcel could be picked up, scanned across
      // the country and delivered without the customer ever being told.
      //
      // Guarded on an actual TRANSITION into a shipped state. Couriers redeliver
      // the same webhook and send several in-transit scans per parcel; without
      // this every scan would re-send the WhatsApp message.
      const becameShipped =
        SHIPPED_STATUSES.has(courierStatus) &&
        !SHIPPED_STATUSES.has(existingShipment.courierStatus ?? '');

      if (becameShipped && existingShipment.orderId) {
        const [order] = await tx
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            customerId: orders.customerId,
          })
          .from(orders)
          .where(and(
            eq(orders.id, existingShipment.orderId),
            eq(orders.orgId, existingShipment.orgId),
          ))
          .limit(1);

        if (order) {
          const payload = await buildOrderNotification(
            tx, existingShipment.orgId, order, 'order.shipped',
          );
          if (payload) {
            await emitOutboxEvent(tx, {
              orgId: existingShipment.orgId,
              eventType: 'order.shipped',
              payload,
            });
          }
        }
      }
    });
  } else {
    // If not found, we don't have businessReference from Aramex payload typically to match the order_id.
    // Assuming Aramex doesn't pass businessReference in this simple webhook schema, we return 404.
    // If we can't upsert without orderId, we will skip it or return error.
    return c.json({ data: null, error: 'shipment_not_found', meta: null }, 404);
  }

  return c.json({ received: true });
});
