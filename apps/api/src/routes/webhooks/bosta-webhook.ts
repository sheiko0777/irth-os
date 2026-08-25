import { parseDecimal } from '@irth/domain';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, getDb } from '../../db';
import { courierShipments, orders, withOrgContext, emitOutboxEvent, buildOrderNotification } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

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

export const bostaWebhookRoute = new Hono();

bostaWebhookRoute.post('/', async (c: Context) => {
  const secret = process.env.BOSTA_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ data: null, error: 'webhook_secret_not_configured', meta: null }, 500);
  }

  const signature = c.req.header('X-Bosta-Signature');
  if (!signature) {
    return c.json({ data: null, error: 'missing_signature', meta: null }, 401);
  }

  const bodyRaw = await c.req.text();

  // Verify HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const expectedBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyRaw));
  const expectedHex = Array.from(new Uint8Array(expectedBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expectedHex, 'hex');

  const { createHash } = await import('node:crypto');
  const hashedSig = createHash('sha256').update(sigBuf).digest();
  const hashedExp = createHash('sha256').update(expBuf).digest();

  if (!timingSafeEqual(hashedSig, hashedExp)) {
    return c.json({ data: null, error: 'invalid_signature', meta: null }, 401);
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(bodyRaw);
  } catch (e) {
    return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  }

  const data = payload?.data;
  if (!data || !data.trackingNumber) {
    return c.json({ data: null, error: 'missing_tracking_number', meta: null }, 400);
  }

  const trackingNumber = data.trackingNumber as string;
  const state = data.state as string;
  // Parsed once, directly from the webhook's decimal string. The old code did
  // `parseFloat(data.cashOnDelivery)` here, then later re-stringified that
  // float and parsed it again for storage (`parseDecimal(String(...))`) at
  // both write sites below — two unneeded float round-trips on a real money
  // value, exactly the re-entry point CLAUDE.md rule 1 forbids. `parseDecimal`
  // reads the decimal text directly; nothing here ever becomes a `number`.
  const codMinor = data.cashOnDelivery ? parseDecimal(String(data.cashOnDelivery)).minor : 0n;

  // Map states
  let courierStatus = 'created';
  if (state === 'DELIVERED') courierStatus = 'delivered';
  else if (state === 'RETURNED') courierStatus = 'returned';
  else if (state === 'RECEIVED_AT_WAREHOUSE' || state === 'OUT_FOR_DELIVERY') courierStatus = 'in_transit';
  else if (state === 'PACKAGE_PICKED_UP') courierStatus = 'picked_up';

  // We need the org_id and order_id to upsert. Since it's by trackingNumber, we must find the shipment first.
  // The spec says "Upsert courier_shipments by tracking_number" but tracking_number is not unique.
  // Wait, the spec says "Upsert using onConflictDoUpdate on order_id for shipments"
  // Let's first try to find the shipment by tracking_number
  const [existingShipment] = await db
    .select()
    .from(courierShipments)
    .where(eq(courierShipments.trackingNumber, trackingNumber));

  if (!existingShipment) {
    // If not found, we can't easily upsert because we don't know the order_id and org_id.
    // However, if the businessReference is the order_id, we can use it.
    // The spec says: { type, data: { trackingNumber, state, businessReference, cashOnDelivery } }
    // Let's assume businessReference is the order_id.
    const businessReference = data.businessReference;
    if (!businessReference) {
      return c.json({ data: null, error: 'shipment_not_found_and_no_reference', meta: null }, 404);
    }

    // In a real scenario we should get orgId from the order.
    // Let's fetch the order to get the orgId.
    // But the instructions say to upsert by tracking number or order_id.
  }

  if (existingShipment) {
    const updatedEvents = [...(existingShipment.webhookEvents || []), payload];
    const isDeliveredAndCod = state === 'DELIVERED' && codMinor > 0n;

    // The tenant comes from the shipment row, not from a session: a webhook has
    // no authenticated user. That is also why this uses withOrgContext directly
    // rather than the request-scoped withOrg helper.
    await withOrgContext(getDb(), existingShipment.orgId, async (tx) => {
      await tx.update(courierShipments)
        .set({
          courierStatus,
          codCollected: isDeliveredAndCod ? true : existingShipment.codCollected,
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
  } else if (data.businessReference) {
    // Attempt to parse businessReference as order_id
    // Need to get orgId from somewhere, let's look up the order
    const { orders } = await import('@irth/db');
    const [order] = await db.select().from(orders).where(eq(orders.id, data.businessReference));

    if (order) {
        const isDeliveredAndCod = state === 'DELIVERED' && codMinor > 0n;
        const { sql } = await import('drizzle-orm');
        await db.insert(courierShipments).values({
            orgId: order.orgId,
            orderId: order.id,
            courier: 'bosta',
            trackingNumber: trackingNumber,
            courierStatus,
            codAmountMinor: codMinor,
            codCollected: isDeliveredAndCod,
            webhookEvents: [payload]
        }).onConflictDoUpdate({
            target: courierShipments.orderId,
            set: {
                courierStatus,
                trackingNumber,
                codAmountMinor: codMinor,
                codCollected: isDeliveredAndCod,
                webhookEvents: sql`${courierShipments.webhookEvents} || ${JSON.stringify([payload])}::jsonb`,
                updatedAt: new Date()
            }
        });
    }
  }

  return c.json({ received: true });
});
