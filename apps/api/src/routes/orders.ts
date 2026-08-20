import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db, getDb, withOrg } from '../db';
import { orders, orderItems, productVariants, products, customers, nextDocumentNumber, formatDocumentNumber, jsonSafe, inventoryItems, inventoryMovements, withIdempotency, IdempotencyError, emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS } from '@irth/db';
import { withAudit } from '@irth/db';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { issueInvoice, type EtaOrderInput } from '../services/eta';
import { EGP, add, fromMinor, multiply, zero } from '@irth/domain';

/** Thrown inside the order transaction so the whole thing rolls back. */
class InsufficientStockError extends Error {
  constructor(readonly variantId: string) {
    super(`Insufficient stock for variant ${variantId}`);
    this.name = 'InsufficientStockError';
  }
}

const ordersRoute = new Hono();

/**
 * Assembles the real order/line/receiver data issueInvoice needs, from the
 * order id alone. Duplicated from apps/admin/src/server/routers/eta.ts's
 * identically-named helper — that file's own copy has the fuller comment on
 * why (itemCode is the SKU, not an ETA-conformant code; the schema has no
 * national-ID field for the >150,000 EGP threshold). Not consolidated into
 * services/eta.ts because that file is deliberately free of any `@irth/db`
 * import — see its own file-banner comment.
 *
 * Returns `null` when the order has no items to declare.
 */
async function buildEtaOrderInput(
  orgId: string,
  orderId: string,
  orderNumber: string,
  orderCurrency: string,
): Promise<EtaOrderInput | null> {
  const [order] = await db.select({ customerId: orders.customerId })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  if (!order) return null;

  const lineRows = await db
    .select({
      quantity: orderItems.quantity,
      priceMinor: orderItems.priceMinor,
      productName: products.name,
      sku: productVariants.sku,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(orderItems.orderId, orderId));
  if (lineRows.length === 0) return null;

  let customerName: string | null = null;
  if (order.customerId) {
    const [customer] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
      .limit(1);
    customerName = customer?.name ?? null;
  }

  return {
    id: orderId,
    orgId,
    orderNumber,
    currency: orderCurrency,
    customerName,
    items: lineRows.map((r) => ({
      description: r.productName,
      itemCode: r.sku,
      quantity: r.quantity,
      unitPriceMinor: r.priceMinor,
    })),
  };
}

const getOrgId = (c: Context): string | undefined => c.get('orgId') as string | undefined;
const getUserId = (c: Context): string | undefined => c.get('userId') as string | undefined;

const createOrderSchema = z.object({
  // Optional so existing callers keep working; a client opts in by sending one.
  // Only the CALLER can tell a retry from a second genuine order — ordering the
  // same item twice in a minute is legitimate, so the server cannot infer it.
  idempotencyKey: z.string().min(1).max(255).optional(),
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

  // Number, stock, order, lines and audit row in ONE transaction, run at most
  // once per idempotency key.
  //
  // What this replaced: the number came from `count(*) + 1` (read-then-write,
  // so two concurrent orders both saw N and both built N+1, and until 0035 the
  // duplicate was silently accepted); the order and its audit row committed
  // separately from the lines; the year was the literal 2026; NOTHING
  // decremented stock; and a retried request created a second order.
  //
  // The lines being a separate autocommit is the one that loses money: an order
  // could commit carrying a total with no items behind it — reconciles against
  // nothing, cannot be repriced.
  let newOrder;
  try {
    newOrder = await withIdempotency(
      getDb(),
      { orgId, operation: 'orders.create', key: data.idempotencyKey, request: data },
      () => withOrg(c, async (tx) => {
        // Claimed inside the transaction, so a rollback releases the number
        // rather than burning it. See nextDocumentNumber for why this is not a
        // Postgres SEQUENCE.
        const seq = await nextDocumentNumber(tx, orgId, 'order');
        const orderNumber = formatDocumentNumber('order', seq);

        // STOCK FIRST, and in the UPDATE's WHERE.
        //
        // There was previously no stock decrement anywhere on this path — an
        // order could always be placed for any quantity of anything, and
        // inventory only moved when someone adjusted it by hand.
        //
        // `quantity >= n` lives in the WHERE rather than a SELECT before it, so
        // the check and the decrement are one statement and cannot be split by
        // a concurrent order. A read-then-write here is precisely how two
        // buyers both pass a "5 in stock" check and both take 5.
        //
        // Zero rows updated means either no inventory record or not enough on
        // hand; both are a refusal, and throwing rolls back the number and the
        // order with it.
        // Cost basis per LINE (not per variant — the same variant can appear
        // as two separate lines with different quantities, and a variantId
        // keyed map would let the second overwrite the first's cost).
        // Captured at the moment stock leaves, see 0039. Merged onto
        // order_items by index below, so finance's order-delivered posting
        // can SUM it directly instead of reconstructing it later from
        // movements.
        const lineCostsMinor: (bigint | null)[] = [];

        for (const item of itemsToInsert) {
          const updated = await tx
            .update(inventoryItems)
            .set({
              quantity: sql`${inventoryItems.quantity} - ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(inventoryItems.orgId, orgId),
              eq(inventoryItems.variantId, item.variantId),
              sql`${inventoryItems.quantity} >= ${item.quantity}`,
            ))
            .returning({ id: inventoryItems.id, quantity: inventoryItems.quantity, averageCostMinor: inventoryItems.averageCostMinor });

          if (updated.length === 0) {
            throw new InsufficientStockError(item.variantId);
          }

          // The average is unaffected by an OUTGOING movement — only receipts
          // move it (packages/db/src/costing.ts) — so the item's current
          // average IS this line's cost basis. NULL means nothing has ever
          // been received into this item with a known cost: the line's COGS
          // is genuinely unknown, not free, and stays NULL rather than 0.
          const avg = updated[0].averageCostMinor;
          const lineCostMinor = avg == null ? null : avg * BigInt(item.quantity);
          lineCostsMinor.push(lineCostMinor);

          // Ledger row, matching inventory.adjust and returns.restock: a stock
          // change absent from the movements table is invisible to any audit
          // and makes the on-hand figure underivable.
          await tx.insert(inventoryMovements).values({
            orgId,
            itemId: updated[0].id,
            type: 'out',
            quantity: item.quantity,
            costMinor: lineCostMinor,
            note: `Order ${orderNumber}`,
          });
        }

        return withAudit(tx, async () => {
          const [insertedOrder] = await tx.insert(orders).values({
            orgId,
            orderNumber,
            status: 'pending',
            totalAmountMinor: total.minor,
            currency: total.currency,
            // NOT `customerId: userId`. customer_id is uuid and refers to
            // customers.id, while Better Auth user ids are text (0034) — so
            // this raised 22P02 and order creation through the API could never
            // succeed. It was also the wrong relationship: the session user
            // PLACED the order, which is what the audit row records; the
            // customer is a separate entity that may not exist yet.
            customerId: null,
          }).returning();

          if (itemsToInsert.length > 0) {
            await tx.insert(orderItems).values(
              itemsToInsert.map((item, i) => ({
                ...item,
                orderId: insertedOrder.id,
                // Index-aligned with the stock-decrement loop above, which
                // built lineCostsMinor in the same order it iterated
                // itemsToInsert — not looked up by variantId, since a variant
                // can appear as two separate lines with different quantities.
                costMinor: lineCostsMinor[i] ?? null,
              })),
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
      }),
    );
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return c.json(
        { data: null, error: 'insufficient_stock', meta: { variantId: err.variantId } },
        409,
      );
    }
    if (err instanceof IdempotencyError) {
      return c.json(
        { data: null, error: err.message, meta: null },
        err.code === 'CONFLICT' ? 409 : 400,
      );
    }
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

  const eventType = OUTBOX_EVENT_BY_STATUS[status];

  const updatedOrder = await withOrg(c, async (tx) => {
    const res = await withAudit(tx, async () => {
        const [row] = await tx.update(orders)
          .set({ status, updatedAt: new Date() })
          .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)))
          .returning();
        return row;
    }, {
      orgId,
      userId,
      action: 'UPDATE_STATUS',
      tableName: 'orders',
      changes: { oldStatus: order.status, newStatus: status }
    });

    // Same transaction as the status change, and only when the status actually
    // moved. The UPDATE has no ne(status) clause, so re-sending the current
    // status succeeds and returns a row — without this guard that would
    // re-notify the customer on every call.
    //
    // This mirrors the admin router's updateStatus. Both paths write the same
    // orders table, and only one of them emitting meant a customer heard about
    // a confirmation made in the admin console but not the identical change
    // made through the API.
    if (eventType && order.status !== status) {
      const payload = await buildOrderNotification(tx, orgId, res, eventType);
      if (payload) {
        await emitOutboxEvent(tx, { orgId, eventType, payload });
      }
    }

    return res;
  });

  if (status === 'delivered') {
      // Fire-and-forget, AFTER the transaction above has committed — issueInvoice
      // makes external HTTP calls, and this route's own withOrg discipline
      // exists specifically so a government API round trip never holds a
      // pooled connection open. Building the input is a plain read, not part
      // of that transaction.
      buildEtaOrderInput(orgId, updatedOrder.id, updatedOrder.orderNumber, updatedOrder.currency)
        .then((etaInput) => etaInput && issueInvoice(etaInput))
        .catch(e => console.error('issueInvoice failed:', e instanceof Error ? e.message : 'unknown error'));
  }

  return c.json({ data: jsonSafe(updatedOrder), error: null, meta: null });
});

export { ordersRoute };
