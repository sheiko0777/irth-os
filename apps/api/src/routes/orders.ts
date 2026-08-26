import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db, getDb, withOrg } from '../db';
import { orders, orderItems, productVariants, products, nextDocumentNumber, formatDocumentNumber, jsonSafe, inventoryItems, inventoryMovements, withIdempotency, IdempotencyError, emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS, etaInvoices } from '@irth/db';
import { withAudit } from '@irth/db';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { EGP, add, fromMinor, multiply, zero } from '@irth/domain';
import { requireRole } from '../middlewares/requireRole';

class InsufficientStockError extends Error {
  constructor(readonly variantId: string) {
    super(`Insufficient stock for variant ${variantId}`);
    this.name = 'InsufficientStockError';
  }
}

const ordersRoute = new Hono();
const getOrgId = (c: Context): string | undefined => c.get('orgId') as string | undefined;
const getUserId = (c: Context): string | undefined => c.get('userId') as string | undefined;

const createOrderSchema = z.object({
  idempotencyKey: z.string().min(1).max(255).optional(),
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().positive() }))
});

ordersRoute.post('/', async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  if (!orgId || !userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  const body = await c.req.json();
  const data = createOrderSchema.parse(body);
  if (data.items.length === 0) return c.json({ data: null, error: 'empty_items', meta: null }, 400);

  const variantIds = data.items.map(item => item.variantId);
  const variants = await db.select({ id: productVariants.id, priceMinor: productVariants.priceMinor, productId: productVariants.productId })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(inArray(productVariants.id, variantIds), eq(products.orgId, orgId)));
  const variantMap = new Map<string, typeof variants[0]>();
  for (const v of variants) variantMap.set(v.id, v);

  let total = zero(EGP);
  const itemsToInsert: { orgId: string, variantId: string, quantity: number, priceMinor: bigint }[] = [];
  for (const item of data.items) {
    const variant = variantMap.get(item.variantId);
    if (!variant) return c.json({ data: null, error: 'variant_not_found', meta: null }, 404);
    if (variant.priceMinor === null) return c.json({ data: null, error: 'variant_has_no_price', meta: null }, 422);
    total = add(total, multiply(fromMinor(variant.priceMinor, EGP), item.quantity));
    itemsToInsert.push({ orgId, variantId: item.variantId, quantity: item.quantity, priceMinor: variant.priceMinor });
  }

  let newOrder;
  try {
    newOrder = await withIdempotency(
      getDb(),
      { orgId, operation: 'orders.create', key: data.idempotencyKey, request: data },
      () => withOrg(c, async (tx) => {
        const seq = await nextDocumentNumber(tx, orgId, 'order');
        const orderNumber = formatDocumentNumber('order', seq);
        const lineCostsMinor: (bigint | null)[] = [];

        for (const item of itemsToInsert) {
          const updated = await tx.update(inventoryItems)
            .set({ quantity: sql`${inventoryItems.quantity} - ${item.quantity}`, updatedAt: new Date() })
            .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, item.variantId), sql`${inventoryItems.quantity} >= ${item.quantity}`))
            .returning({ id: inventoryItems.id, averageCostMinor: inventoryItems.averageCostMinor });
          if (updated.length === 0) throw new InsufficientStockError(item.variantId);
          const avg = updated[0].averageCostMinor;
          const lineCostMinor = avg == null ? null : avg * BigInt(item.quantity);
          lineCostsMinor.push(lineCostMinor);
          await tx.insert(inventoryMovements).values({ orgId, itemId: updated[0].id, type: 'out', quantity: item.quantity, costMinor: lineCostMinor, note: `Order ${orderNumber}` });
        }

        return withAudit(tx, async () => {
          const [insertedOrder] = await tx.insert(orders).values({ orgId, orderNumber, status: 'pending', totalAmountMinor: total.minor, currency: total.currency, customerId: null }).returning();
          if (itemsToInsert.length > 0) {
            await tx.insert(orderItems).values(itemsToInsert.map((item, i) => ({ ...item, orderId: insertedOrder.id, costMinor: lineCostsMinor[i] ?? null })));
          }
          return insertedOrder;
        }, { orgId, userId, action: 'CREATE', tableName: 'orders', changes: { items: itemsToInsert } });
      }),
    );
  } catch (err) {
    if (err instanceof InsufficientStockError) return c.json({ data: null, error: 'insufficient_stock', meta: { variantId: err.variantId } }, 409);
    if (err instanceof IdempotencyError) return c.json({ data: null, error: err.message, meta: null }, err.code === 'CONFLICT' ? 409 : 400);
    throw err;
  }

  return c.json({ data: jsonSafe(newOrder), error: null, meta: null });
});

ordersRoute.get('/', async (c: Context) => {
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  const [list, countResult] = await Promise.all([
    db.select().from(orders).where(eq(orders.orgId, orgId)).orderBy(desc(orders.createdAt)),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.orgId, orgId))
  ]);
  return c.json({ data: jsonSafe(list), error: null, meta: { total: Number(countResult[0]?.count || 0) } });
});

ordersRoute.get('/:id', async (c: Context) => {
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  const id = c.req.param('id');
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));
  if (!order) return c.json({ data: null, error: 'not_found', meta: null }, 404);
  return c.json({ data: jsonSafe(order), error: null, meta: null });
});

const updateStatusSchema = z.object({ status: z.enum(['pending', 'confirmed', 'payment_failed', 'shipped', 'delivered', 'cancelled']) });

ordersRoute.patch('/:id/status', requireRole('owner', 'admin'), async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  if (!orgId || !userId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  const id = c.req.param('id');
  const { status } = updateStatusSchema.parse(await c.req.json());
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));
  if (!order) return c.json({ data: null, error: 'not_found', meta: null }, 404);

  const eventType = OUTBOX_EVENT_BY_STATUS[status];
  const updatedOrder = await withOrg(c, async (tx) => {
    const res = await withAudit(tx, async () => {
      const [row] = await tx.update(orders)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)))
        .returning();
      return row;
    }, { orgId, userId, action: 'UPDATE_STATUS', tableName: 'orders', changes: { oldStatus: order.status, newStatus: status } });

    if (eventType && order.status !== status) {
      const payload = await buildOrderNotification(tx, orgId, res, eventType);
      if (payload) await emitOutboxEvent(tx, { orgId, eventType, payload });
    }

    if (status === 'delivered' && order.status !== 'delivered') {
      await tx.insert(etaInvoices).values({ orgId, orderId: res.id, status: 'pending', retryCount: 0 }).onConflictDoNothing({ target: etaInvoices.orderId });
      await emitOutboxEvent(tx, {
        orgId,
        eventType: 'eta.invoice.issue',
        payload: { orgId, orderId: res.id, orderNumber: res.orderNumber, currency: res.currency },
      });
    }

    return res;
  });

  return c.json({ data: jsonSafe(updatedOrder), error: null, meta: null });
});

export { ordersRoute };
