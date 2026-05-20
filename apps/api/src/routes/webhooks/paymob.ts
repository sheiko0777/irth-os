import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../../db";
import { orders, auditLog } from "@irth/db";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

const paymobRoute = new Hono();

paymobRoute.post("/", async (c: Context) => {
  const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
  if (!hmacSecret) {
    return c.json(
      { data: null, error: "hmac_secret_not_configured", meta: null },
      500,
    );
  }

  const hmacHeader = c.req.header("hmac");
  if (!hmacHeader) {
    return c.json({ data: null, error: "missing_hmac", meta: null }, 401);
  }

  const bodyRaw = await c.req.text();
  const body = JSON.parse(bodyRaw);

  const { obj } = body;
  if (!obj) {
    return c.json({ data: null, error: "invalid_payload", meta: null }, 400);
  }

  const lexoKeys = [
    "amount_cents",
    "created_at",
    "currency",
    "error_occured",
    "has_parent_transaction",
    "id",
    "integration_id",
    "is_3d_secure",
    "is_auth",
    "is_capture",
    "is_refunded",
    "is_standalone_payment",
    "is_voided",
    "order",
    "owner",
    "pending",
    "source_data.pan",
    "source_data.sub_type",
    "source_data.type",
    "success",
  ];

  let concatenatedString = "";
  for (const key of lexoKeys) {
    const parts = key.split(".");
    let val = obj;
    for (const p of parts) {
      val = val?.[p];
    }
    concatenatedString += val ?? "";
  }

  const calculatedHmac = crypto
    .createHmac("sha512", hmacSecret)
    .update(concatenatedString)
    .digest("hex");

  if (calculatedHmac !== hmacHeader) {
    return c.json({ data: null, error: "invalid_hmac", meta: null }, 401);
  }

  const orderIdFromPaymob = obj.order?.merchant_order_id as string | undefined;
  if (!orderIdFromPaymob) {
    return c.json({ data: null, error: "missing_order_id", meta: null }, 400);
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderIdFromPaymob));
  if (!order) {
    return c.json({ data: null, error: "order_not_found", meta: null }, 404);
  }

  const isSuccess = obj.success === true;
  const newStatus = isSuccess ? "confirmed" : "payment_failed";

  const [updatedOrder] = await db
    .update(orders)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.orgId, order.orgId)))
    .returning();

  await db.insert(auditLog).values({
    orgId: order.orgId,
    userId: null,
    action: "PAYMOB_WEBHOOK",
    tableName: "orders",
    recordId: order.id,
    changes: { oldStatus: order.status, newStatus, paymobPayload: obj },
  });

  return c.json({ data: { success: true }, error: null, meta: null });
});

export { paymobRoute };
