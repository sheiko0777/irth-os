import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';
import { courierShipments } from '@irth/db';
import { eq } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';

export const aramexWebhookRoute = new Hono();

aramexWebhookRoute.post('/', async (c: Context) => {
  const token = process.env.ARAMEX_WEBHOOK_TOKEN;
  if (!token) {
    return c.json({ data: null, error: 'webhook_token_not_configured', meta: null }, 500);
  }

  const headerToken = c.req.header('X-Aramex-Token');
  if (!headerToken) {
    return c.json({ data: null, error: 'invalid_token', meta: null }, 401);
  }

  const sigBuf = Buffer.from(headerToken);
  const expBuf = Buffer.from(token);

  const hashedSig = createHash('sha256').update(sigBuf).digest();
  const hashedExp = createHash('sha256').update(expBuf).digest();

  if (!timingSafeEqual(hashedSig, hashedExp)) {
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

    await db.update(courierShipments)
      .set({
        courierStatus,
        webhookEvents: updatedEvents,
        updatedAt: new Date()
      })
      .where(eq(courierShipments.id, existingShipment.id));
  } else {
    // If not found, we don't have businessReference from Aramex payload typically to match the order_id.
    // Assuming Aramex doesn't pass businessReference in this simple webhook schema, we return 404.
    // If we can't upsert without orderId, we will skip it or return error.
    return c.json({ data: null, error: 'shipment_not_found', meta: null }, 404);
  }

  return c.json({ received: true });
});
