import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { db, getDb, withOrg } from '../db';
import { orders, orderItems, productVariants, products, jsonSafe, placeOrder, InsufficientStockError, orderRepCondition, type EffectiveAccess, withIdempotency, IdempotencyError, emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS, postOrderDeliveredEntry } from '@irth/db';
import { withAudit, transitionOrderStatus } from '@irth/db';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { EGP, add, fromMinor, multiply, zero } from '@irth/domain';
import { OrderStatusSchema } from '@irth/types';
import { requirePermission } from '../middlewares/requirePermission';
import { requireOrgId } from '../middlewares/requireOrgId';

const ordersRoute = new Hono();

const getUserId = (c: Context): string => c.get('userId') as string;

/**
 * A rep's narrowing (PR-2a/2b): these reads run on the unscoped connection,
 * where 0077/0078's policies do not apply, so the same condition the admin
 * uses goes into the query itself. Undefined for staff.
 */
const repCondition = (c: Context) => {
  const access = c.get('access') as EffectiveAccess | undefined;
  return access ? orderRepCondition(access) : undefined;
};

const createOrderSchema = z.object({
  // Optional so existing callers keep working; a client opts in by sending one.
  // Only the CALLER can tell a retry from a second genuine order — ordering the
  // same item twice in a minute is legitimate, so the server cannot infer it.
  idempotencyKey: z.string().min(1).max(255).optional(),
  paymentMethod: z.enum(['cod', 'online']).optional(),
  items: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().positive()
  }))
});

ordersRoute.post('/', requireOrgId(), requirePermission('orders', 'write'), async (c: Context) => {
  const orgId = c.get('orgId') as string;
  const userId = getUserId(c);
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
      // Number, stock, order, lines and audit row: @irth/db's placeOrder, the
      // one implementation shared with the sales rep's order (PR-2b). Before
      // it, this route claimed numbers with count(*)+1, committed the lines
      // separately from the order, never moved stock, and created a second
      // order on a retry — see placeOrder for what each guard is for.
      () => withOrg(c, async (tx) => placeOrder(tx, {
        orgId,
        userId,
        lines: itemsToInsert,
        currency: total.currency,
        totalAmountMinor: total.minor,
        paymentMethod: data.paymentMethod ?? 'cod',
        // Not the session user: customer_id refers to customers.id (0034).
        customerId: null,
        auditChanges: { items: itemsToInsert },
      })),
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

ordersRoute.get('/', requireOrgId(), requirePermission('orders', 'view'), async (c: Context) => {
  const orgId = c.get('orgId') as string;

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = (page - 1) * limit;

  const [list, countResult] = await Promise.all([
    db.select().from(orders).where(and(eq(orders.orgId, orgId), repCondition(c))).limit(limit).offset(offset).orderBy(desc(orders.createdAt)),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(and(eq(orders.orgId, orgId), repCondition(c)))
  ]);

  const totalCount = Number(countResult[0]?.count || 0);

  return c.json({ data: jsonSafe(list), error: null, meta: { total: totalCount, page, limit } });
});

ordersRoute.get('/:id', requireOrgId(), requirePermission('orders', 'view'), async (c: Context) => {
  const orgId = c.get('orgId') as string;
  const id = c.req.param('id');
  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId), repCondition(c)));
  
  if (!order) {
    return c.json({ data: null, error: 'not_found', meta: null }, 404);
  }
  return c.json({ data: jsonSafe(order), error: null, meta: null });
});

const updateStatusSchema = z.object({
  status: OrderStatusSchema
});

// requirePermission, not just the generic orgId/userId presence check every
// other route here does: this transition can post ledger entries (revenue,
// COGS) and fire a real ETA e-invoice submission on 'delivered' (see below),
// so it needs the same authorization as the identical mutation's tRPC
// counterpart, apps/admin/src/server/routers/orders.ts's updateStatus
// (requireOrgId(), requirePermission('orders', 'write')). Found via the archaeology sweep:
// this route had no role guard at all — any authenticated member could
// trigger both side effects.
ordersRoute.patch('/:id/status', requireOrgId(), requirePermission('orders', 'write'), async (c: Context) => {
  const orgId = c.get('orgId') as string;
  const userId = getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  
  const { status } = updateStatusSchema.parse(body);

  const [order] = await db.select().from(orders).where(and(eq(orders.id, id as string), eq(orders.orgId, orgId), repCondition(c)));
  
  if (!order) {
    return c.json({ data: null, error: 'not_found', meta: null }, 404);
  }

  const eventType = OUTBOX_EVENT_BY_STATUS[status];

  const updatedOrder = await withOrg(c, async (tx) => {
    const transition = await transitionOrderStatus(tx, { orgId, orderId: order.id, newStatus: status });
    if (!transition) return null;
    const { previousStatus } = transition;
    const res = await withAudit(tx, async () => {
        // Preserve the response shape and database timestamp after the raw update.
        const [row] = await tx.select().from(orders)
          .where(and(eq(orders.id, id as string), eq(orders.orgId, orgId)));
        return row;
    }, {
      orgId,
      userId,
      action: 'UPDATE_STATUS',
      tableName: 'orders',
      changes: { oldStatus: previousStatus, newStatus: status }
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
    if (eventType && previousStatus !== status) {
      const payload = await buildOrderNotification(tx, orgId, res, eventType);
      if (payload) {
        await emitOutboxEvent(tx, { orgId, eventType, payload });
      }
    }

    // Same transaction as the status change, and only on a genuine
    // transition (same reasoning as the eventType guard above — without it,
    // re-PATCHing an already-delivered order would resubmit to ETA every
    // time). This replaces what used to be a fire-and-forget
    // .then().catch() run AFTER this transaction committed, with no
    // waitUntil() — on Cloudflare Workers an un-awaited promise not
    // registered with waitUntil can be killed the instant the response
    // returns to the client, so the submission could silently never run at
    // all. Routing through the outbox means the event's existence commits
    // atomically with the status change: a killed isolate loses nothing, and
    // the cron drain (already running under waitUntil — see index.ts's
    // scheduled() handler) picks it up regardless.
    if (status === 'delivered' && previousStatus !== status) {
      await emitOutboxEvent(tx, { orgId, eventType: 'eta.invoice.issue', payload: { orgId, orderId: res.id } });
    }

    // Revenue, VAT and COGS. This route's own comment above claimed the
    // transition "can post ledger entries (revenue, COGS)" while this
    // transaction posted none — the entry was only ever written by the tRPC
    // twin in apps/admin. An order delivered through this endpoint filed an
    // ETA tax invoice for a sale the ledger never recorded. The guard lives
    // inside postOrderDeliveredEntry, so the call is unconditional here.
    await postOrderDeliveredEntry(tx, {
      orgId,
      order,
      previousStatus,
      newStatus: status,
      createdBy: userId,
    });

    return res;
  });

  if (!updatedOrder) return c.json({ data: null, error: 'not_found', meta: null }, 404);
  return c.json({ data: jsonSafe(updatedOrder), error: null, meta: null });
});

export { ordersRoute };
