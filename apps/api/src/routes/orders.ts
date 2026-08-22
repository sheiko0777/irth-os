import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { orders, orderItems, productVariants, products, inventoryItems, orderNumberCounters, etaInvoices } from '@irth/db';
import { withAudit } from '@irth/db';
import { eq, and, desc, gte, inArray, sql } from 'drizzle-orm';
import { sumMinor, multiplyMinorByQuantity, minorToDecimalString } from '@irth/utils';
import { issueInvoice } from '../services/eta';

const ordersRoute = new Hono();

const getOrgId = (c: Context): string | undefined => c.get('orgId') as string | undefined;
const getUserId = (c: Context): string | undefined => c.get('userId') as string | undefined;

const createOrderSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().positive()
  })).min(1)
});

/**
 * Thrown inside the order-creation transaction to abort it (Postgres rolls
 * back everything the transaction did so far) and carry a specific HTTP
 * response out to the route handler.
 */
class OrderError extends Error {
  constructor(public code: string, public status: 404 | 409 | 422, public meta: Record<string, unknown> | null = null) {
    super(code);
  }
}

ordersRoute.post('/', async (c: Context) => {
  const orgId = getOrgId(c);
  const userId = getUserId(c);
  if (!orgId || !userId) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }
  const body = await c.req.json();
  const data = createOrderSchema.parse(body);

  // Merge duplicate variantId entries so stock is checked/decremented once
  // per variant for the combined quantity, not once per line.
  const qtyByVariant = new Map<string, number>();
  for (const item of data.items) {
    qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  const uniqueVariantIds = [...qtyByVariant.keys()];

  try {
    const insertedOrder = await db.transaction(async (tx) => {
      const variants = await tx.select({
        id: productVariants.id,
        priceMinor: productVariants.priceMinor,
      })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(
          inArray(productVariants.id, uniqueVariantIds),
          eq(products.orgId, orgId)
        ));

      const variantMap = new Map(variants.map(v => [v.id, v]));

      const lines: { variantId: string; quantity: number; unitPriceMinor: number }[] = [];
      for (const variantId of uniqueVariantIds) {
        const variant = variantMap.get(variantId);
        if (!variant) {
          throw new OrderError('variant_not_found', 404, { variantId });
        }
        // A variant with no price set is a data problem, not a free item —
        // Number(null) silently evaluating to 0 in the old float-based path
        // would have sold it for nothing.
        if (variant.priceMinor == null) {
          throw new OrderError('variant_has_no_price', 422, { variantId });
        }
        lines.push({ variantId, quantity: qtyByVariant.get(variantId)!, unitPriceMinor: variant.priceMinor });
      }

      // Conditional decrement per line: only succeeds if enough stock exists
      // right now, in the same transaction as everything else. Any line that
      // can't be fulfilled throws, rolling back every decrement already
      // applied for this order — no partial/oversold orders.
      for (const line of lines) {
        const [decremented] = await tx.update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} - ${line.quantity}`, updatedAt: new Date() })
          .where(and(
            eq(inventoryItems.orgId, orgId),
            eq(inventoryItems.variantId, line.variantId),
            gte(inventoryItems.quantity, line.quantity)
          ))
          .returning({ id: inventoryItems.id });
        if (!decremented) {
          throw new OrderError('insufficient_stock', 409, { variantId: line.variantId });
        }
      }

      // Atomic, gapless-per-org-per-year order number. Replaces the old
      // `count(*) + 1` read, which raced under concurrent inserts (two
      // requests could read the same count and both get the same number)
      // and hardcoded the year into the format string.
      const year = new Date().getFullYear();
      const [{ lastSeq }] = await tx.insert(orderNumberCounters)
        .values({ orgId, year, lastSeq: 1 })
        .onConflictDoUpdate({
          target: orderNumberCounters.orgId,
          set: {
            lastSeq: sql`CASE WHEN ${orderNumberCounters.year} = ${year} THEN ${orderNumberCounters.lastSeq} + 1 ELSE 1 END`,
            year,
          },
        })
        .returning({ lastSeq: orderNumberCounters.lastSeq });
      const orderNumber = `IRT-${year}-${String(lastSeq).padStart(4, '0')}`;

      const totalMinor = sumMinor(lines.map(l => multiplyMinorByQuantity(l.unitPriceMinor, l.quantity)));

      const order = await withAudit(tx, async () => {
        const [row] = await tx.insert(orders).values({
          orgId,
          orderNumber,
          status: 'pending',
          totalAmount: minorToDecimalString(totalMinor),
          totalAmountMinor: totalMinor,
          customerId: userId,
        }).returning();
        return row;
      }, {
        orgId,
        userId,
        action: 'CREATE',
        tableName: 'orders',
        changes: { items: lines },
      });

      await tx.insert(orderItems).values(lines.map(l => ({
        orgId,
        orderId: order.id,
        variantId: l.variantId,
        quantity: l.quantity,
        price: minorToDecimalString(l.unitPriceMinor),
        priceMinor: l.unitPriceMinor,
      })));

      return order;
    });

    return c.json({ data: insertedOrder, error: null, meta: null });
  } catch (err) {
    if (err instanceof OrderError) {
      return c.json({ data: null, error: err.code, meta: err.meta }, err.status);
    }
    throw err;
  }
});

ordersRoute.get('/', async (c: Context) => {
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);

  const [list, countResult] = await Promise.all([
    db.select().from(orders).where(eq(orders.orgId, orgId)).orderBy(desc(orders.createdAt)),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.orgId, orgId))
  ]);

  const totalCount = Number(countResult[0]?.count || 0);

  return c.json({ data: list, error: null, meta: { total: totalCount } });
});

ordersRoute.get('/:id', async (c: Context) => {
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  const id = c.req.param('id');
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));

  if (!order) {
    return c.json({ data: null, error: 'not_found', meta: null }, 404);
  }
  return c.json({ data: order, error: null, meta: null });
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

  const updatedOrder = await withAudit(db, async () => {
      const [res] = await db.update(orders)
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
  });

  if (status === 'delivered') {
      // Claim the invoice slot before submitting anything: `eta_invoices` has
      // a unique index on orderId, so this insert only succeeds once per
      // order, ever. Without it, marking an order 'delivered' more than once
      // (a retried request, a double click, a status flip-flopping back and
      // forth) resubmitted the same tax invoice to ETA every single time —
      // duplicate government e-invoices for one sale.
      const claimed = await db.insert(etaInvoices)
        .values({ orgId: updatedOrder.orgId, orderId: updatedOrder.id, status: 'pending' })
        .onConflictDoNothing({ target: etaInvoices.orderId })
        .returning({ id: etaInvoices.id });

      if (claimed.length > 0) {
        const invoiceRowId = claimed[0].id;
        issueInvoice(updatedOrder)
          .then((result) => db.update(etaInvoices)
            .set(result
              ? { status: 'submitted', etaUuid: result.uuid, longId: result.longId, qrCodeData: result.qrCodeData, submittedAt: new Date() }
              : { status: 'rejected', errorMessage: 'issuance_failed', retryCount: sql`${etaInvoices.retryCount} + 1` })
            .where(eq(etaInvoices.id, invoiceRowId)))
          .catch(e => console.error('issueInvoice failed:', e instanceof Error ? e.message : 'unknown error'));
      }
  }

  return c.json({ data: updatedOrder, error: null, meta: null });
});

export { ordersRoute };
