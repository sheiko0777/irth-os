import { Hono } from 'hono';
import type { Context } from 'hono';
import { getDb, getEnv } from '../../db';
import {
  orders, orderItems, customers, productVariants, inventoryItems, inventoryMovements,
  inventoryDiscrepancies, orgMembers, notifications,
  shopifyConnections, shopifyWebhookDeliveries,
  withOrgContext, withAudit, jsonSafe,
  nextDocumentNumber, formatDocumentNumber,
  emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS,
} from '@irth/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { verifyShopifyWebhook } from '../../middlewares/verifyShopifyWebhook';

/**
 * Inbound half of the Shopify sync (the dashboard-owns-catalog outbound half
 * lives in the outbox worker). A webhook carries no session, so org
 * resolution has to come from the request itself — see `resolveWebhookOrg`
 * below — the same "no authenticated caller, scope comes from context
 * instead" shape as the Bosta webhook route.
 *
 * Registered event topics: orders/create, orders/updated, orders/cancelled,
 * customers/create, customers/update, inventory_levels/update,
 * app/uninstalled. Two registration paths point at these same routes —
 * `scripts/registerShopifyWebhooks.mjs` (one-time, single-tenant legacy
 * setup) and `services/shopifyConnection.ts`'s `registerShopifyWebhooks()`
 * (automatic, per-org, run from the OAuth callback) — both use the same
 * explicit topic→route map so a shop registered through either path lands
 * on a route that actually exists here.
 */

const shopifyWebhookRoute = new Hono();

/**
 * Legacy single-tenant fallback. The org every webhook wrote into before
 * per-org connections existed — `resolveWebhookOrg` only reaches for this
 * when the request's shop domain doesn't match any `shopify_connections`
 * row, so an org that has genuinely connected is never at the mercy of this
 * env var.
 */
function getSyncOrgId(): string | undefined {
  return (getEnv()?.SHOPIFY_ORG_ID as string | undefined) ?? process.env.SHOPIFY_ORG_ID;
}

interface ResolvedWebhookOrg {
  orgId: string;
  /** `null` on the legacy fallback path — nothing to record a delivery against. */
  connectionId: string | null;
}

/**
 * Resolves which org a webhook belongs to from the request itself, not from
 * a single global env var. Shopify sends `X-Shopify-Shop-Domain` on every
 * webhook delivery — this is the ONLY place in the multi-tenant flow that
 * decides tenancy, so getting it right here is what makes every downstream
 * `withOrgContext(db, orgId, ...)` call actually safe. Falls back to the
 * legacy single-tenant org only when no connection matches the shop domain
 * (or the header is missing, which only the pre-existing legacy integration
 * would ever trigger — a connection-based webhook always carries the header).
 */
async function resolveWebhookOrg(c: Context, db: ReturnType<typeof getDb>): Promise<ResolvedWebhookOrg | null> {
  const shopDomain = c.req.header('x-shopify-shop-domain')?.toLowerCase().trim();
  if (shopDomain) {
    const [connection] = await db.select({ id: shopifyConnections.id, orgId: shopifyConnections.orgId })
      .from(shopifyConnections)
      .where(and(eq(shopifyConnections.shopDomain, shopDomain), eq(shopifyConnections.status, 'active')));
    if (connection) return { orgId: connection.orgId, connectionId: connection.id };
  }
  const legacyOrgId = getSyncOrgId();
  return legacyOrgId ? { orgId: legacyOrgId, connectionId: null } : null;
}

/**
 * Idempotency + audit trail for the multi-tenant path, keyed on
 * `(connectionId, webhookId)` — Shopify's own recommended dedup key
 * (`X-Shopify-Webhook-Id`), redelivered on retry. Insert-first: if the
 * unique index rejects it, this is a redelivery — the caller should treat it
 * as already-processed rather than re-running the handler. Returns `true` if
 * this delivery is new (caller should proceed), `false` if it's a repeat.
 * No-ops (returns `true`) on the legacy fallback path, which has no
 * connection row to record against and keeps its own existing per-handler
 * idempotency checks.
 */
async function recordDelivery(
  db: ReturnType<typeof getDb>,
  resolved: ResolvedWebhookOrg,
  c: Context,
  topic: string,
  payload: unknown,
): Promise<boolean> {
  if (!resolved.connectionId) return true;
  const webhookId = c.req.header('x-shopify-webhook-id');
  if (!webhookId) return true; // Nothing to dedup against — proceed, handler-level checks still apply.
  try {
    await db.insert(shopifyWebhookDeliveries).values({
      orgId: resolved.orgId, connectionId: resolved.connectionId, webhookId, topic,
      payload: payload as object,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return false; // Redelivery, already recorded.
    throw err;
  }
  await db.update(shopifyConnections).set({ lastWebhookAt: new Date() }).where(eq(shopifyConnections.id, resolved.connectionId));
  return true;
}

interface ShopifyLineItem {
  sku: string | null;
  variant_id: number | string | null;
  quantity: number;
  price: string;
}
interface ShopifyCustomerPayload {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}
interface ShopifyOrderPayload {
  id: number | string;
  name: string; // "#1001"
  financial_status: string | null; // 'paid' | 'pending' | 'refunded' | ...
  cancelled_at: string | null;
  currency: string;
  total_price: string;
  customer?: ShopifyCustomerPayload | null;
  line_items: ShopifyLineItem[];
}

/** Shopify's numeric/GID id, normalised to the string form this schema stores. */
function shopifyGid(resource: string, id: number | string): string {
  const raw = String(id);
  return raw.startsWith('gid://') ? raw : `gid://shopify/${resource}/${raw}`;
}

/**
 * A validly-signed body can still be malformed (Shopify-side serialization
 * bugs, proxy mangling). An unguarded JSON.parse throws past the handler,
 * surfaces as a plain-text 500, and — because Shopify redelivers anything it
 * did not get a 200 for — turns one bad payload into a permanent retry storm.
 * Same guard pattern as the paymob/bosta/aramex webhooks (commit baf16d1);
 * this file was added later and missed it. Returns null instead of throwing;
 * callers reject with 400 so Shopify drops the delivery.
 */
function parseWebhookBody<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function findOrCreateCustomer(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  orgId: string,
  payload: ShopifyCustomerPayload | null | undefined,
): Promise<string | null> {
  if (!payload) return null;
  const shopifyCustomerId = shopifyGid('Customer', payload.id);

  const [existing] = await tx.select().from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.shopifyCustomerId, shopifyCustomerId)));
  if (existing) return existing.id;

  // Fall back to matching by email before creating a new row — a customer
  // who first ordered through the dashboard and later checked out on the
  // storefront with the same address should link to their existing record,
  // not fork into a duplicate with no order/loyalty history.
  if (payload.email) {
    const [byEmail] = await tx.select().from(customers)
      .where(and(eq(customers.orgId, orgId), eq(customers.email, payload.email)));
    if (byEmail) {
      await tx.update(customers)
        .set({ shopifyCustomerId, updatedAt: new Date() })
        .where(eq(customers.id, byEmail.id));
      return byEmail.id;
    }
  }

  const name = [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim() || 'Shopify Customer';
  const [created] = await tx.insert(customers).values({
    orgId,
    name,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    shopifyCustomerId,
  }).returning();
  return created.id;
}

function mapFinancialStatusToOrderStatus(financialStatus: string | null, cancelledAt: string | null): 'pending' | 'confirmed' | 'payment_failed' | 'cancelled' {
  if (cancelledAt) return 'cancelled';
  if (financialStatus === 'paid' || financialStatus === 'partially_paid') return 'confirmed';
  if (financialStatus === 'voided' || financialStatus === 'refunded') return 'payment_failed';
  return 'pending';
}

shopifyWebhookRoute.post('/orders-create', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<ShopifyOrderPayload>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  if (!(await recordDelivery(db, resolved, c, 'orders/create', payload))) {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }
  const shopifyOrderId = shopifyGid('Order', payload.id);

  // Idempotent by design, not just by intent: Shopify redelivers webhooks it
  // did not get a 200 for, and this topic in particular is documented as
  // "at least once, not exactly once". Re-processing the same order id must
  // be a no-op, not a second order or a second stock decrement.
  const [alreadySynced] = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.shopifyOrderId, shopifyOrderId)));
  if (alreadySynced) {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }

  const status = mapFinancialStatusToOrderStatus(payload.financial_status, payload.cancelled_at);

  let result;
  try {
    result = await withOrgContext(db, orgId, async (tx) => {
    const customerId = await findOrCreateCustomer(tx, orgId, payload.customer);

    // Resolve each Shopify line to a local variant. A line with no match
    // (never pushed from the dashboard, or pushed to a different org) is
    // recorded on the order's audit trail rather than silently dropped or
    // used to block the whole order — the sale on Shopify already happened
    // and cannot be undone by a sync gap on this side.
    const unmatchedSkus: string[] = [];
    const resolvedItems: Array<{ variantId: string; quantity: number; priceMinor: bigint }> = [];
    const discrepancies: Array<{
      variantId: string;
      requestedQuantity: number;
      appliedQuantity: number;
      shortfallQuantity: number;
      movementId: string | null;
    }> = [];

    for (const line of payload.line_items) {
      const shopifyVariantId = line.variant_id ? shopifyGid('ProductVariant', line.variant_id) : null;
      const [variant] = shopifyVariantId
        ? await tx.select().from(productVariants)
            .where(and(eq(productVariants.orgId, orgId), eq(productVariants.shopifyVariantId, shopifyVariantId)))
        : [];

      if (!variant) {
        unmatchedSkus.push(line.sku ?? String(line.variant_id ?? 'unknown'));
        continue;
      }

      // Shopify's price is a decimal string already, in the same currency as
      // the order — parsed as fixed-point cents, never through a float.
      const [whole, fraction = '0'] = line.price.split('.');
      const priceMinor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));

      resolvedItems.push({ variantId: variant.id, quantity: line.quantity, priceMinor });

      // Same atomic `quantity >= n` guard the dashboard's own order-creation
      // path uses (apps/api/src/routes/orders.ts) — but on a miss, this
      // cannot reject the sale the way that path does (throw, roll back):
      // Shopify already took the money. Apply what's actually on hand, floor
      // at zero, and record the shortfall — the previous behaviour here was
      // an unconditional decrement with no floor at all, which could drive
      // quantity negative.
      const guarded = await tx.update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} - ${line.quantity}`, updatedAt: new Date() })
        .where(and(
          eq(inventoryItems.orgId, orgId),
          eq(inventoryItems.variantId, variant.id),
          sql`${inventoryItems.quantity} >= ${line.quantity}`,
        ))
        .returning({ id: inventoryItems.id });

      if (guarded.length > 0) {
        await tx.insert(inventoryMovements).values({
          orgId,
          itemId: guarded[0].id,
          type: 'out',
          quantity: line.quantity,
          note: `Shopify order ${payload.name}`,
        });
        continue;
      }

      // Either no inventory_items row exists for this variant, or not enough
      // is on hand. Read the real current quantity (0 if no row at all) and
      // apply the most this sale can take without going negative; the rest
      // is a genuine shortfall, recorded below rather than hidden.
      const [item] = await tx.select({ id: inventoryItems.id, quantity: inventoryItems.quantity })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, variant.id)));

      const appliedQuantity = item ? Math.max(0, Math.min(item.quantity, line.quantity)) : 0;
      let movementId: string | null = null;

      if (item && appliedQuantity > 0) {
        await tx.update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} - ${appliedQuantity}`, updatedAt: new Date() })
          .where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.orgId, orgId)));

        const [movement] = await tx.insert(inventoryMovements).values({
          orgId,
          itemId: item.id,
          type: 'adjustment',
          quantity: -appliedQuantity,
          note: `Shopify order ${payload.name}: requested ${line.quantity}, only ${appliedQuantity} on hand — floored, see inventory_discrepancies`,
        }).returning({ id: inventoryMovements.id });
        movementId = movement.id;
      }

      discrepancies.push({
        variantId: variant.id,
        requestedQuantity: line.quantity,
        appliedQuantity,
        shortfallQuantity: line.quantity - appliedQuantity,
        movementId,
      });
    }

    const seq = await nextDocumentNumber(tx, orgId, 'order');
    const orderNumber = formatDocumentNumber('order', seq);

    const totalMinor = (() => {
      const [whole, fraction = '0'] = payload.total_price.split('.');
      return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
    })();

    const insertedOrder = await withAudit(tx, async () => {
      const [row] = await tx.insert(orders).values({
        orgId,
        orderNumber,
        status,
        totalAmountMinor: totalMinor,
        currency: (payload.currency || 'EGP').slice(0, 3).toUpperCase(),
        customerId,
        shopifyOrderId,
      }).returning();

      if (resolvedItems.length > 0) {
        await tx.insert(orderItems).values(
          resolvedItems.map(item => ({
            orgId,
            orderId: row.id,
            variantId: item.variantId,
            quantity: item.quantity,
            priceMinor: item.priceMinor,
          })),
        );
      }

      return row;
    }, {
      orgId,
      userId: null,
      action: 'SHOPIFY_ORDER_CREATE',
      tableName: 'orders',
      changes: { shopifyOrderId, orderNumber, unmatchedSkus },
    });

    if (discrepancies.length > 0) {
      await tx.insert(inventoryDiscrepancies).values(
        discrepancies.map((d) => ({
          orgId,
          orderId: insertedOrder.id,
          shopifyOrderId,
          variantId: d.variantId,
          requestedQuantity: d.requestedQuantity,
          appliedQuantity: d.appliedQuantity,
          shortfallQuantity: d.shortfallQuantity,
          movementId: d.movementId,
        })),
      );

      // Fan out one notification per owner/admin — this webhook has no
      // authenticated caller (notifications.user_id is NOT NULL, and there
      // is no org-wide broadcast variant of this table), and a stock
      // shortfall is exactly the kind of thing whoever runs this org needs
      // to see promptly, not discover later as a mysteriously short shelf.
      const admins = await tx.select({ userId: orgMembers.userId }).from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), inArray(orgMembers.role, ['owner', 'admin'])));
      for (const { userId } of admins) {
        await tx.insert(notifications).values({
          orgId,
          userId,
          type: 'stock_discrepancy',
          title: `نقص في المخزون — طلب Shopify ${payload.name}`,
          body: `${discrepancies.length} صنف/أصناف لم يتوفر لها مخزون كافٍ لتلبية الطلب بالكامل، وتم تطبيق الكمية المتاحة فقط.`,
          read: false,
        });
      }
    }

    const eventType = OUTBOX_EVENT_BY_STATUS[status];
    if (eventType) {
      const notification = await buildOrderNotification(tx, orgId, insertedOrder, eventType);
      if (notification) await emitOutboxEvent(tx, { orgId, eventType, payload: notification });
    }

    return { order: insertedOrder, unmatchedSkus };
    });
  } catch (err) {
    // Two concurrent deliveries of the same order can both pass the
    // alreadySynced pre-check above before either commits — the unique index
    // on (org_id, shopify_order_id) is the real backstop, and until now
    // nothing caught the violation it raises, so the losing request
    // surfaced as an unhandled 500 instead of the same idempotent response
    // the pre-check already returns for a genuine duplicate delivery.
    if ((err as { code?: string }).code === '23505') {
      const [synced] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.orgId, orgId), eq(orders.shopifyOrderId, shopifyOrderId)));
      if (synced) return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
    }
    throw err;
  }

  return c.json({ data: jsonSafe(result), error: null, meta: null }, 201);
});

shopifyWebhookRoute.post('/orders-updated', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<ShopifyOrderPayload>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  if (!(await recordDelivery(db, resolved, c, 'orders/updated', payload))) {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }
  const shopifyOrderId = shopifyGid('Order', payload.id);

  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.shopifyOrderId, shopifyOrderId)));
  // orders/updated can arrive before orders/create has been processed (no
  // ordering guarantee across topics) — nothing to update yet is not an
  // error, just early; orders/create will pick up the current state when it
  // lands.
  if (!existing) return c.json({ data: { skipped: 'order_not_found_yet' }, error: null, meta: null });

  const newStatus = mapFinancialStatusToOrderStatus(payload.financial_status, payload.cancelled_at);
  if (newStatus === existing.status) {
    return c.json({ data: { unchanged: true }, error: null, meta: null });
  }

  const updated = await withOrgContext(db, orgId, (tx) => withAudit(tx, async () => {
    const [row] = await tx.update(orders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(orders.id, existing.id), eq(orders.orgId, orgId)))
      .returning();
    return row;
  }, {
    orgId,
    userId: null,
    action: 'SHOPIFY_ORDER_UPDATE',
    tableName: 'orders',
    changes: { oldStatus: existing.status, newStatus },
  }));

  return c.json({ data: jsonSafe(updated), error: null, meta: null });
});

shopifyWebhookRoute.post('/orders-cancelled', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<{ id: number | string }>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  if (!(await recordDelivery(db, resolved, c, 'orders/cancelled', payload))) {
    return c.json({ data: { unchanged: true }, error: null, meta: null });
  }
  const shopifyOrderId = shopifyGid('Order', payload.id);

  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.shopifyOrderId, shopifyOrderId)));
  if (!existing || existing.status === 'cancelled') {
    return c.json({ data: { unchanged: true }, error: null, meta: null });
  }

  const updated = await withOrgContext(db, orgId, (tx) => withAudit(tx, async () => {
    const [row] = await tx.update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(orders.id, existing.id), eq(orders.orgId, orgId)))
      .returning();

    // Restock what was actually taken, not what was requested — for a line
    // that orders/create floored on a shortfall, that's
    // inventory_discrepancies.applied_quantity, not order_items.quantity;
    // restocking the requested amount for a floored line would inflate
    // stock beyond what was ever removed. This is new: cancelling a Shopify
    // order never gave inventory back before.
    const items = await tx.select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, existing.id));
    const discrepancyRows = await tx.select({
      variantId: inventoryDiscrepancies.variantId,
      appliedQuantity: inventoryDiscrepancies.appliedQuantity,
    }).from(inventoryDiscrepancies).where(eq(inventoryDiscrepancies.orderId, existing.id));
    const appliedByVariant = new Map(discrepancyRows.map((d) => [d.variantId, d.appliedQuantity]));

    for (const item of items) {
      const restockQuantity = appliedByVariant.get(item.variantId) ?? item.quantity;
      if (restockQuantity <= 0) continue;

      const [invItem] = await tx.select({ id: inventoryItems.id }).from(inventoryItems)
        .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, item.variantId)));
      if (!invItem) continue;

      await tx.update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} + ${restockQuantity}`, updatedAt: new Date() })
        .where(eq(inventoryItems.id, invItem.id));

      await tx.insert(inventoryMovements).values({
        orgId,
        itemId: invItem.id,
        type: 'in',
        quantity: restockQuantity,
        note: `Shopify order ${existing.orderNumber} cancelled — restocked`,
      });
    }

    return row;
  }, {
    orgId,
    userId: null,
    action: 'SHOPIFY_ORDER_CANCEL',
    tableName: 'orders',
    changes: { oldStatus: existing.status, newStatus: 'cancelled' },
  }));

  return c.json({ data: jsonSafe(updated), error: null, meta: null });
});

shopifyWebhookRoute.post('/customers-upsert', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<ShopifyCustomerPayload>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  // Same route serves CUSTOMERS_CREATE and CUSTOMERS_UPDATE (see the module
  // header comment) — the delivery-id dedup key already disambiguates
  // retries of the same event, so recording under one shared topic name here
  // is fine; `findOrCreateCustomer` is idempotent regardless.
  if (!(await recordDelivery(db, resolved, c, 'customers/upsert', payload))) {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }

  const customerId = await withOrgContext(db, orgId, (tx) => findOrCreateCustomer(tx, orgId, payload));

  return c.json({ data: { customerId }, error: null, meta: null });
});

shopifyWebhookRoute.post('/inventory-levels-update', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<{ inventory_item_id: number | string; available: number }>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  if (!(await recordDelivery(db, resolved, c, 'inventory_levels/update', payload))) {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }
  const shopifyInventoryItemId = shopifyGid('InventoryItem', payload.inventory_item_id);

  const [variant] = await db.select().from(productVariants)
    .where(and(eq(productVariants.orgId, orgId), eq(productVariants.shopifyInventoryItemId, shopifyInventoryItemId)));

  // Not every Shopify inventory item is one this dashboard has pushed (e.g. a
  // product created directly in Shopify, outside the sync) — nothing to
  // reconcile against, not an error.
  if (!variant) return c.json({ data: { skipped: 'no_matching_variant' }, error: null, meta: null });

  await withOrgContext(db, orgId, async (tx) => {
    const [item] = await tx.select().from(inventoryItems)
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, variant.id)));

    if (!item) return;

    const delta = payload.available - item.quantity;
    if (delta === 0) return;

    await tx.update(inventoryItems)
      .set({ quantity: payload.available, updatedAt: new Date() })
      .where(eq(inventoryItems.id, item.id));

    await tx.insert(inventoryMovements).values({
      orgId,
      itemId: item.id,
      type: 'adjustment',
      quantity: delta,
      note: 'Shopify inventory_levels/update (edited directly in Shopify)',
    });
  });

  return c.json({ data: { synced: true }, error: null, meta: null });
});

/**
 * A merchant uninstalling the app from the Shopify side — the store keeps
 * running, it just stops talking to this integration. The connection row is
 * marked, not deleted: reconnecting later (via OAuth again) should find and
 * reuse the same `shopify_connections.org_id` unique slot rather than
 * fighting a leftover row, and keeping history (installed_at, past
 * lastSyncAt/lastWebhookAt) is useful for support.
 */
shopifyWebhookRoute.post('/app-uninstalled', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  // No connection to mark — either already uninstalled/never connected, or
  // the legacy single-tenant path (which has no concept of "uninstall").
  if (!resolved?.connectionId) return c.json({ data: { skipped: 'no_connection' }, error: null, meta: null });

  await db.update(shopifyConnections)
    .set({ status: 'uninstalled', uninstalledAt: new Date(), updatedAt: new Date() })
    .where(eq(shopifyConnections.id, resolved.connectionId));

  return c.json({ data: { uninstalled: true }, error: null, meta: null });
});

export { shopifyWebhookRoute };
