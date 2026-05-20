import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { db } from "../db";
import { orders, orderItems, productVariants, products } from "@irth/db";
import { withAudit } from "@irth/db";
import { eq, and, desc } from "drizzle-orm";
import { issueInvoice } from "../services/eta";

const ordersRoute = new Hono();

const getOrgId = (c: Context): string =>
  (c.get("orgId") as string) || "00000000-0000-0000-0000-000000000000";
const getUserId = (c: Context): string =>
  (c.get("userId") as string) || "00000000-0000-0000-0000-000000000000";

const createOrderSchema = z.object({
  items: z.array(
    z.object({
      variantId: z.string().uuid(),
      quantity: z.number().int().positive(),
    }),
  ),
});

ordersRoute.post("/", async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  const body = await c.req.json();

  const data = createOrderSchema.parse(body);

  let totalAmount = 0;
  const itemsToInsert: {
    orgId: string;
    variantId: string;
    quantity: number;
    price: string;
  }[] = [];

  for (const item of data.items) {
    const variantResult = await db
      .select({
        id: productVariants.id,
        price: productVariants.price,
        productId: productVariants.productId,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(
        and(eq(productVariants.id, item.variantId), eq(products.orgId, orgId)),
      );
    if (!variantResult.length) {
      return c.json(
        { data: null, error: "variant_not_found", meta: null },
        404,
      );
    }
    const variant = variantResult[0];
    const price = Number(variant.price);
    totalAmount += price * item.quantity;

    itemsToInsert.push({
      orgId,
      variantId: item.variantId,
      quantity: item.quantity,
      price: variant.price!,
    });
  }

  const existingOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.orgId, orgId));
  const seq = (existingOrders.length + 1).toString().padStart(4, "0");
  const orderNumber = `IRT-2026-${seq}`;

  const newOrder = await withAudit(
    db,
    async () => {
      const [insertedOrder] = await db
        .insert(orders)
        .values({
          orgId,
          orderNumber,
          status: "pending",
          totalAmount: totalAmount.toString(),
          customerId: userId,
        })
        .returning();
      return insertedOrder;
    },
    {
      orgId,
      userId,
      action: "CREATE",
      tableName: "orders",
      changes: { items: itemsToInsert },
    },
  );

  for (const item of itemsToInsert) {
    await db.insert(orderItems).values({
      ...item,
      orderId: newOrder.id,
    });
  }

  return c.json({ data: newOrder, error: null, meta: null });
});

ordersRoute.get("/", async (c: Context) => {
  const orgId = getOrgId(c);
  const list = await db
    .select()
    .from(orders)
    .where(eq(orders.orgId, orgId))
    .orderBy(desc(orders.createdAt));
  return c.json({ data: list, error: null, meta: null });
});

ordersRoute.get("/:id", async (c: Context) => {
  const orgId = getOrgId(c);
  const id = c.req.param("id");
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));

  if (!order) {
    return c.json({ data: null, error: "not_found", meta: null }, 404);
  }
  return c.json({ data: order, error: null, meta: null });
});

const updateStatusSchema = z.object({
  status: z.enum([
    "pending",
    "confirmed",
    "payment_failed",
    "shipped",
    "delivered",
    "cancelled",
  ]),
});

ordersRoute.patch("/:id/status", async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  const id = c.req.param("id");
  const body = await c.req.json();

  const { status } = updateStatusSchema.parse(body);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));

  if (!order) {
    return c.json({ data: null, error: "not_found", meta: null }, 404);
  }

  const updatedOrder = await withAudit(
    db,
    async () => {
      const [res] = await db
        .update(orders)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)))
        .returning();
      return res;
    },
    {
      orgId,
      userId,
      action: "UPDATE_STATUS",
      tableName: "orders",
      changes: { oldStatus: order.status, newStatus: status },
    },
  );

  if (status === "delivered") {
    issueInvoice(updatedOrder).catch((e) => console.error(e));
  }

  return c.json({ data: updatedOrder, error: null, meta: null });
});

export { ordersRoute };
