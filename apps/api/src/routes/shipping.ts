import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { orders, shipmentTracking, auditLog } from '@irth/db';
import { eq, and } from 'drizzle-orm';

const shippingRoute = new Hono();

const getOrgId = (c: Context): string | undefined => c.get('orgId') as string | undefined;
const getUserId = (c: Context): string | undefined => c.get('userId') as string | undefined;

const createShippingSchema = z.object({
  orderId: z.string().uuid()
});

shippingRoute.post('/create', async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  if (!orgId || !userId) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }
  const body = await c.req.json();

  const { orderId } = createShippingSchema.parse(body);

  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));

  if (!order) {
    return c.json({ data: null, error: 'order_not_found', meta: null }, 404);
  }

  if (order.status !== 'confirmed') {
     return c.json({ data: null, error: 'order_not_confirmed', meta: null }, 400);
  }

  const bostaApiKey = process.env.BOSTA_API_KEY;
  if (!bostaApiKey) {
     console.error('BOSTA_API_KEY not configured');
     return c.json({ data: null, error: 'shipping_unavailable', meta: null }, 200); 
  }

  try {
     const bostaRequest = await fetch('https://app.bosta.co/api/v0/deliveries', {
       method: 'POST',
       headers: {
         'Authorization': bostaApiKey,
         'Content-Type': 'application/json'
       },
       body: JSON.stringify({
         type: 10,
         specs: { packageDetails: { itemsCount: 1 } },
         returnAddress: { firstLine: "Egypt" }, // Mock data, replace with real
         dropOffAddress: { firstLine: "Egypt" },
         receiver: { firstName: "Customer", phone: "01000000000" }
       })
     });

     if (!bostaRequest.ok) {
       throw new Error(`Bosta API error: ${bostaRequest.status}`);
     }

     const bostaResponse = await bostaRequest.json() as { _id: string; trackingNumber: string; [key: string]: unknown };

     const [shipment] = await db.insert(shipmentTracking).values({
         orgId,
         orderId: order.id,
         provider: 'bosta',
         trackingNumber: bostaResponse.trackingNumber,
         status: 'Created',
         rawPayload: bostaResponse
     }).returning();

     await db.insert(auditLog).values({
         orgId,
         userId,
         action: 'CREATE_SHIPMENT',
         tableName: 'shipment_tracking',
         recordId: shipment.id,
         changes: { provider: 'bosta', trackingNumber: bostaResponse.trackingNumber }
     });

     return c.json({ data: shipment, error: null, meta: null });
  } catch (error) {
     console.error('Bosta API failed:', error instanceof Error ? error.message : 'unknown error');
     return c.json({ data: null, error: 'shipping_unavailable', meta: null }, 200);
  }
});

export { shippingRoute };
