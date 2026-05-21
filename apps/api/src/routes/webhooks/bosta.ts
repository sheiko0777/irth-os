import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';
import { orders, shipmentTracking, auditLog } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import { verifyHmac } from '../../middlewares/verifyWebhook';
import { issueInvoice } from '../../services/eta';

const bostaRoute = new Hono();

bostaRoute.post('/', verifyHmac('BOSTA_WEBHOOK_SECRET', 'x-bosta-signature'), async (c: Context) => {
  const bodyRaw = c.get('rawBody') as string;

  const payload = JSON.parse(bodyRaw);
  const trackingNumber = payload.trackingNumber as string | undefined;
  const bostaState = payload.state as string | undefined;

  if (!trackingNumber) {
    return c.json({ data: null, error: 'missing_tracking_number', meta: null }, 400);
  }

  const [shipment] = await db.select().from(shipmentTracking).where(eq(shipmentTracking.trackingNumber, trackingNumber));
  
  if (!shipment) {
    return c.json({ data: null, error: 'shipment_not_found', meta: null }, 404);
  }

  // Update shipment status
  await db.update(shipmentTracking)
    .set({ status: bostaState, rawPayload: payload, updatedAt: new Date() })
    .where(and(eq(shipmentTracking.id, shipment.id), eq(shipmentTracking.orgId, shipment.orgId)));

  // Map Bosta state to Order state
  let newOrderStatus: 'shipped' | 'delivered' | 'cancelled' | null = null;
  if (bostaState === 'Picked up' || bostaState === 'In Transit') {
    newOrderStatus = 'shipped';
  } else if (bostaState === 'Delivered') {
    newOrderStatus = 'delivered';
  } else if (bostaState === 'Cancelled' || bostaState === 'Returned') {
    newOrderStatus = 'cancelled';
  }

  if (newOrderStatus) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, shipment.orderId), eq(orders.orgId, shipment.orgId)));
    if (order && order.status !== newOrderStatus) {
        const [updatedOrder] = await db.update(orders)
          .set({ status: newOrderStatus, updatedAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)))
          .returning();

        await db.insert(auditLog).values({
          orgId: order.orgId,
          userId: null,
          action: 'BOSTA_WEBHOOK_STATUS_UPDATE',
          tableName: 'orders',
          recordId: order.id,
          changes: { oldStatus: order.status, newStatus: newOrderStatus, bostaState }
        });

        if (newOrderStatus === 'delivered') {
           // Call issueInvoice on delivered
           issueInvoice(updatedOrder).catch(e => console.error(e));
        }
    }
  }

  return c.json({ data: { success: true }, error: null, meta: null });
});

export { bostaRoute };
