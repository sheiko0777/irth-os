import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { orders } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { requireOrgId } from '../middlewares/requireOrgId';

const shippingRoute = new Hono();

const createShippingSchema = z.object({
  orderId: z.string().uuid()
});

// POST /api/shipping/create — gated as NOT IMPLEMENTED.
//
// This route used to POST straight to Bosta's production deliveries API
// (https://app.bosta.co/api/v0/deliveries) with a HARDCODED placeholder
// receiver and address:
//     returnAddress:  { firstLine: "Egypt" }
//     dropOffAddress: { firstLine: "Egypt" }
//     receiver:       { firstName: "Customer", phone: "01000000000" }
// i.e. every call created a real, malformed Bosta shipment for a fake
// customer. Nothing in the product invokes this endpoint, so it was doing
// nothing useful and one manual hit would pollute the Bosta account.
//
// Wiring it for real needs data this repo does not have yet:
//   - the org's return / warehouse address (no such field on `organizations`)
//   - Bosta's structured city / zone / district taxonomy — a free-text
//     `customers.address` will not geocode
//   - COD amount when `order.paymentMethod === 'cod'`
//     (from `order.totalAmountMinor`)
//   - package weight / dimensions
// Until those exist, the route validates the order and returns 501 rather
// than fabricating a shipment.
shippingRoute.post('/create', requireOrgId(), async (c: Context) => {
  const orgId = c.get('orgId') as string;
  const body = await c.req.json();

  const { orderId } = createShippingSchema.parse(body);

  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));

  if (!order) {
    return c.json({ data: null, error: 'order_not_found', meta: null }, 404);
  }

  if (order.status !== 'confirmed') {
    return c.json({ data: null, error: 'order_not_confirmed', meta: null }, 400);
  }

  return c.json({ data: null, error: 'shipment_creation_not_implemented', meta: null }, 501);
});

export { shippingRoute };
