import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db, withOrg } from '../db';
import { orders, orderItems, productVariants, products, nextDocumentNumber, formatDocumentNumber, jsonSafe } from '@irth/db';
import { withAudit } from '@irth/db';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { issueInvoice } from '../services/eta';
import { EGP, add, fromMinor, multiply, zero } from '@irth/domain';

const ordersRoute = new Hono();

const getOrgId = (c: Context): string | undefined => c.get('orgId') as string | undefined;
const getUserId = (c: Context): string | undefined => c.get('userId') as string | undefined;

const createOrderSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().positive()
  }))
});

ordersRoute.post('/', async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  if (!orgId || !userId) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }
  const body = await c.req.json();

  const data = createOrderSchema.parse(body);

  if (data.items.length === 0) {
    return c.json({ data: null, error: 'empty_items', meta: null }, 400);
  }

  const variantIds = data.items.map(item => item.variantId);

  const variants = await db.select({
    id: productVariants.id,
    priceMinor: productVariants.priceMinor,
    productId: productVariants.productId
  })
  .from(productVariants)
  .innerJoin(products, eq(productVariants.productId, products.id))
  .where(and(
    inArray(productVariants.id, variantIds),
    eq(products.orgId, orgId)
  ));

  const variantMap = new Map<string, typeof variants[0]>();
  for (const v of variants) {
    variantMap.set(v.id, v);
  }

  // Accumulated in minor units. This was `totalAmount += Number(variant.price)
  // * item.quantity` — a float multiply per line, summed into a float, on the
  // only code path that creates an order.
  let total = zero(EGP);
  const itemsToInsert: { orgId: string, variantId: string, quantity: number, priceMinor: bigint }[] = [];

  for (const item of data.items) {
    const variant = variantMap.get(item.variantId);
    if (!variant) {
      return c.json({ data: null, error: 'variant_not_found', meta: null }, 404);
    }
    if (variant.priceMinor === null) {
      return c.json({ data: null, error: 'variant_has_no_price', meta: null }, 422);
    }

    const unit = fromMinor(variant.priceMinor, EGP);
    total = add(total, multiply(unit, item.quantity));

    itemsToInsert.push({
      orgId,
      variantId: item.variantId,
      quantity: item.quantity,
      priceMinor: variant.priceMinor,
    });
  }

  // Number, order, lines and audit row in ONE transaction.
  //
  // Previously: the number came from `count(*) + 1` (read-then-write, so two
  // concurrent orders both saw N and both built N+1 — and until 0035 the
  // duplicate was silently accepted); the order and its audit row committed
  // separately from the lines; and the year was the literal 2026.
  //
  // The lines being a separate autocommit is the one that loses money: an order
  // could commit with a total and no items behind it, which reconciles against
  // nothing and cannot be repriced.
  const newOrder = await withOrg(c, async (tx) => {
    // Claimed inside the transaction, so a rollback releases the number instead
    // of burning it. See nextDocumentNumber for why this is not a SEQUENCE.
    const seq = await nextDocumentNumber(tx, orgId, 'order');
    const orderNumber = formatDocumentNumber('order', seq);

    return withAudit(tx, async () => {
      const [insertedOrder] = await tx.insert(orders).values({
        orgId,
        orderNumber,
        status: 'pending',
        totalAmountMinor: total.minor,
        currency: total.currency,
        // NOT `customerId: userId`. customer_id is uuid and refers to
        // customers.id, while Better Auth user ids are text (0034) — so this
        // raised 22P02 and order creation through the API could never succeed.
        // It was also the wrong relationship: the session user PLACED the
        // order, which is what the audit row below records; the customer is a
        // separate entity that may not exist yet.
        customerId: null,
      }).returning();

      if (itemsToInsert.length > 0) {
        await tx.insert(orderItems).values(
          itemsToInsert.map((item) => ({ ...item, orderId: insertedOrder.id })),
        );
      }

      return insertedOrder;
    }, {
      orgId,
      userId,
      action: 'CREATE',
      tableName: 'orders',
      changes: { items: itemsToInsert }
    });
  });

  return c.json({ data: jsonSafe(newOrder), error: null, meta: null });
});

ordersRoute.get('/', async (c: Context) => {
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  
  const [list, countResult] = await Promise.all([
    db.select().from(orders).where(eq(orders.orgId, orgId)).orderBy(desc(orders.createdAt)),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.orgId, orgId))
  ]);

  const totalCount = Number(countResult[0]?.count || 0);

  return c.json({ data: jsonSafe(list), error: null, meta: { total: totalCount } });
});

ordersRoute.get('/:id', async (c: Context) => {
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  const id = c.req.param('id');
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));
  
  if (!order) {
    return c.json({ data: null, error: 'not_found', meta: null }, 404);
  }
  return c.json({ data: jsonSafe(order), error: null, meta: null });
});

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'payment_failed', 'shipped', 'delivered', 'cancelled'])
});

ordersRoute.patch('/:id/status', async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  if (!orgId || !userId) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }
  const id = c.req.param('id');
  const body = await c.req.json();
  
  const { status } = updateStatusSchema.parse(body);

  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));
  
  if (!order) {
    return c.json({ data: null, error: 'not_found', meta: null }, 404);
  }

  const updatedOrder = await withOrg(c, (tx) => withAudit(tx, async () => {
      const [res] = await tx.update(orders)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)))
        .returning();
      return res;
  }, {
    orgId,
    userId,
    action: 'UPDATE_STATUS',
    tableName: 'orders',
    changes: { oldStatus: order.status, newStatus: status }
  }));

  if (status === 'delivered') {
      issueInvoice(updatedOrder).catch(e => console.error('issueInvoice failed:', e instanceof Error ? e.message : 'unknown error'));
  }

  return c.json({ data: jsonSafe(updatedOrder), error: null, meta: null });
});

export { ordersRoute };
