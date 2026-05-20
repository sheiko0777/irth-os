import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../../db";
import { orders, shipmentTracking, auditLog } from "@irth/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { issueInvoice } from "../../services/eta";

const bostaRoute = new Hono();

bostaRoute.post("/", async (c: Context) => {
  const bostaSecret =
    process.env.BOSTA_WEBHOOK_SECRET || process.env.BOSTA_API_KEY;
  if (!bostaSecret) {
    return c.json(
      { data: null, error: "bosta_secret_not_configured", meta: null },
      500,
    );
  }

  const hmacHeader = c.req.header("x-bosta-signature");
  if (!hmacHeader) {
    return c.json({ data: null, error: "missing_signature", meta: null }, 401);
  }

  const bodyRaw = await c.req.text();
  const calculatedHmac = crypto
    .createHmac("sha512", bostaSecret)
    .update(bodyRaw)
    .digest("hex");

  if (calculatedHmac !== hmacHeader) {
    return c.json({ data: null, error: "invalid_signature", meta: null }, 401);
  }

  const payload = JSON.parse(bodyRaw);
  const trackingNumber = payload.trackingNumber as string | undefined;
  const bostaState = payload.state as string | undefined;

  if (!trackingNumber) {
    return c.json(
      { data: null, error: "missing_tracking_number", meta: null },
      400,
    );
  }

  const [shipment] = await db
    .select()
    .from(shipmentTracking)
    .where(
      and(
        eq(shipmentTracking.trackingNumber, trackingNumber),
        eq(shipmentTracking.orgId, c.req.header("org_id") || "system"),
      ),
    );

  if (!shipment) {
    return c.json({ data: null, error: "shipment_not_found", meta: null }, 404);
  }

  // Update shipment status
  await db
    .update(shipmentTracking)
    .set({ status: bostaState, rawPayload: payload, updatedAt: new Date() })
    .where(
      and(
        eq(shipmentTracking.id, shipment.id),
        eq(shipmentTracking.orgId, shipment.orgId),
      ),
    );

  // Map Bosta state to Order state
  let newOrderStatus: "shipped" | "delivered" | "cancelled" | null = null;
  if (bostaState === "Picked up" || bostaState === "In Transit") {
    newOrderStatus = "shipped";
  } else if (bostaState === "Delivered") {
    newOrderStatus = "delivered";
  } else if (bostaState === "Cancelled" || bostaState === "Returned") {
    newOrderStatus = "cancelled";
  }

  if (newOrderStatus) {
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(eq(orders.id, shipment.orderId), eq(orders.orgId, shipment.orgId)),
      );
    if (order && order.status !== newOrderStatus) {
      const [updatedOrder] = await db
        .update(orders)
        .set({ status: newOrderStatus, updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)))
        .returning();

      await db.insert(auditLog).values({
        orgId: order.orgId,
        userId: null,
        action: "BOSTA_WEBHOOK_STATUS_UPDATE",
        tableName: "orders",
        recordId: order.id,
        changes: {
          oldStatus: order.status,
          newStatus: newOrderStatus,
          bostaState,
        },
      });

      if (newOrderStatus === "delivered") {
        // Call issueInvoice on delivered
        issueInvoice(updatedOrder).catch((e) => console.error(e));
      }
    }
  }

  return c.json({ data: { success: true }, error: null, meta: null });
});

export { bostaRoute };
