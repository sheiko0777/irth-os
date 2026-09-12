import { Hono } from 'hono';
import type { Context } from 'hono';
import { getDb, getEnv } from '../../db';
import {
  orders, orderItems, customers, productVariants, inventoryItems, inventoryMovements,
  inventoryDiscrepancies, inventoryLevelDiscrepancies, orgMembers, notifications,
  shopifyConnections, shopifyWebhookDeliveries,
  withOrgContext, withAudit, jsonSafe,
  nextDocumentNumber, formatDocumentNumber,
  emitOutboxEvent, buildOrderNotification, OUTBOX_EVENT_BY_STATUS,
} from '@irth/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { verifyShopifyWebhook } from '../../middlewares/verifyShopifyWebhook';
import { UnsupportedCurrencyError, assertSupportedCurrency } from '@irth/domain';

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
 * when the request's shop-domain header is absent. A supplied domain must
 * match an active connection and can never fall back to this env var.
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
 * legacy single-tenant org only when the header is missing, which only the
 * pre-existing legacy integration would ever trigger. A supplied domain
 * without an active connection is refused, including an empty header.
 */
async function resolveWebhookOrg(c: Context, db: ReturnType<typeof getDb>): Promise<ResolvedWebhookOrg | null> {
  const shopDomain = c.req.header('x-shopify-shop-domain')?.toLowerCase().trim();
  if (shopDomain !== undefined) {
    const [connection] = await db.select({ id: shopifyConnections.id, orgId: shopifyConnections.orgId })
      .from(shopifyConnections)
      .where(and(eq(shopifyConnections.shopDomain, shopDomain), eq(shopifyConnections.status, 'active')));
    if (connection) return { orgId: connection.orgId, connectionId: connection.id };
    return null;
  }
  const legacyOrgId = getSyncOrgId();
  return legacyOrgId ? { orgId: legacyOrgId, connectionId: null } : null;
}

type DbOrTx = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

type DeliveryClaim =
  | { kind: 'new'; deliveryId: string }
  | { kind: 'retry'; deliveryId: string }
  | { kind: 'processed' }
  // No durable dedup possible (legacy single-tenant path, or Shopify omitted
  // the webhook-id header) — the caller's own existing per-handler checks
  // (e.g. orders-create's `alreadySynced` lookup) are the real backstop.
  | { kind: 'unrecorded' };

/**
 * Durable inbox claim for one webhook delivery, keyed on
 * `(connectionId, webhookId)` — Shopify's own recommended dedup key
 * (`X-Shopify-Webhook-Id`), redelivered on retry.
 *
 * Fix for a real defect (see the reviewed implementation plan's finding
 * F01): the previous version of this function treated "a delivery row with
 * this id already exists" as "already processed" — but the row is inserted
 * BEFORE the business transaction runs, so a crash, timeout, or any error
 * other than the orders-table's own unique-constraint race, landing between
 * that insert and the transaction committing, left a delivery row on record
 * with NOTHING actually done. On Shopify's automatic redelivery (same
 * webhook id) the old code hit the (connectionId, webhookId) unique
 * constraint immediately and returned early with `alreadyProcessed: true` —
 * before ever reaching the caller's own order-existence check — so the order
 * was silently lost forever; Shopify saw a 200 and stopped retrying.
 *
 * The schema already had `status`/`error`/`processedAt` columns for exactly
 * this lifecycle (`packages/db/src/schema/shopify.ts`) — nothing here ever
 * read or wrote them; a genuinely new delivery is inserted as `'received'`.
 * A redelivery now looks up the EXISTING row's status: only `'processed'` is
 * safe to short-circuit on. `'received'`/`'failed'` mean the business effect
 * never durably completed, so the caller must reprocess, reusing the same
 * row (via `markDeliveryProcessed`/`markDeliveryFailed`) rather than losing
 * the attempt.
 *
 * The id is generated client-side (`crypto.randomUUID()`, native in Workers
 * same as a browser) rather than read back via `.returning()` — this insert
 * otherwise matches the prior version's shape exactly, so it stays
 * compatible with every existing test's mock of a plain `insert(...).values(...)`.
 */
async function claimDelivery(
  db: ReturnType<typeof getDb>,
  resolved: ResolvedWebhookOrg,
  c: Context,
  topic: string,
  payload: unknown,
): Promise<DeliveryClaim> {
  if (!resolved.connectionId) return { kind: 'unrecorded' };
  const webhookId = c.req.header('x-shopify-webhook-id');
  if (!webhookId) return { kind: 'unrecorded' };

  const deliveryId = crypto.randomUUID();
  try {
    await db.insert(shopifyWebhookDeliveries).values({
      id: deliveryId, orgId: resolved.orgId, connectionId: resolved.connectionId, webhookId, topic,
      payload: payload as object, status: 'received',
    });
    await db.update(shopifyConnections).set({ lastWebhookAt: new Date() }).where(eq(shopifyConnections.id, resolved.connectionId));
    return { kind: 'new', deliveryId };
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err;
  }

  // Redelivery — decide based on durable state, not mere existence.
  const [existing] = await db.select({ id: shopifyWebhookDeliveries.id, status: shopifyWebhookDeliveries.status })
    .from(shopifyWebhookDeliveries)
    .where(and(eq(shopifyWebhookDeliveries.connectionId, resolved.connectionId), eq(shopifyWebhookDeliveries.webhookId, webhookId)));
  if (existing?.status === 'processed') return { kind: 'processed' };
  return { kind: 'retry', deliveryId: existing?.id ?? '' };
}

async function markDeliveryProcessed(executor: DbOrTx, deliveryId: string): Promise<void> {
  if (!deliveryId) return;
  await executor.update(shopifyWebhookDeliveries)
    .set({ status: 'processed', processedAt: new Date() })
    .where(eq(shopifyWebhookDeliveries.id, deliveryId));
}

async function markDeliveryFailed(db: ReturnType<typeof getDb>, deliveryId: string, error: unknown): Promise<void> {
  if (!deliveryId) return;
  try {
    await db.update(shopifyWebhookDeliveries)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
      .where(eq(shopifyWebhookDeliveries.id, deliveryId));
  } catch {
    // Best-effort — called from a catch block about to rethrow the real
    // error; a failure writing this marker must never mask that error.
  }
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
  payment_gateway_names?: string[];
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

type ShopifyWebhookTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Shopify sends money as a decimal string ("1234.56") in the order's own
 * currency. Parse as fixed-point minor units — never through a float, per
 * CLAUDE.md rule 1.
 */
function shopifyMoneyToMinor(decimal: string): bigint {
  const [whole, fraction = '0'] = decimal.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

interface AppliedOrderLines {
  /** Lines that resolved to a local variant, for the order_items insert. */
  resolvedItems: Array<{ variantId: string; quantity: number; priceMinor: bigint }>;
  /** SKUs (or variant ids) with no local variant — recorded on the audit trail. */
  unmatchedSkus: string[];
  /** Lines where stock was floored below what the sale asked for. */
  discrepancies: Array<{
    variantId: string;
    requestedQuantity: number;
    appliedQuantity: number;
    shortfallQuantity: number;
    movementId: string | null;
  }>;
}

/**
 * Resolves each Shopify line to a local variant and decrements inventory for
 * it. The webhook cannot reject the sale on a stock miss the way the
 * dashboard's own order path does — Shopify already took the money — so it
 * applies what is on hand, floors at zero, and records the shortfall.
 *
 * Lines are locked in an order that is stable ACROSS requests (Shopify's
 * variant id, then sku) so two concurrent deliveries sharing variants can't
 * deadlock by taking row locks in opposite orders. See the inline notes on
 * the guarded UPDATE and the FOR UPDATE fallback for why the slow path needs
 * an explicit row lock.
 */
async function applyShopifyOrderLines(
  tx: ShopifyWebhookTx,
  orgId: string,
  payload: ShopifyOrderPayload,
): Promise<AppliedOrderLines> {
  const unmatchedSkus: string[] = [];
  const resolvedItems: AppliedOrderLines['resolvedItems'] = [];
  const discrepancies: AppliedOrderLines['discrepancies'] = [];

  // Deterministic lock order across concurrent deliveries.
  //
  // Every iteration below takes a row lock on inventory_items — the guarded
  // UPDATE takes one, and the FOR UPDATE on the shortfall path holds one for
  // longer. Shopify decides the order of `line_items`, so two orders sharing
  // variants X and Y can arrive as [X,Y] and [Y,X]; one transaction then
  // holds X waiting for Y while the other holds Y waiting for X, and
  // Postgres kills one with a deadlock. Sorting by a key that is stable
  // ACROSS requests — Shopify's own variant id, falling back to sku — makes
  // every transaction acquire the same rows in the same sequence, which is
  // the standard and complete answer to that class of deadlock.
  //
  // Sorted before resolution because the lock order is what matters, and our
  // internal variant id is not known until the batched lookup below has run.
  // resolvedItems and unmatchedSkus are order-insensitive (a set of rows and
  // a set of labels), so nothing else changes.
  const orderedLines = [...payload.line_items].sort((a, b) => {
    const ka = String(a.variant_id ?? a.sku ?? '');
    const kb = String(b.variant_id ?? b.sku ?? '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // One batched lookup for every line's variant instead of a SELECT per line
  // (previously N sequential round-trips for an N-line order). Safe to pull
  // out of the loop below: resolving a variant id to a row has no ordering
  // requirement, unlike the inventory_items row locks the loop takes next —
  // those still walk `orderedLines` one at a time, in the same
  // across-request-stable order, exactly as before.
  const shopifyVariantIds = [
    ...new Set(
      orderedLines
        .map((line) => (line.variant_id ? shopifyGid('ProductVariant', line.variant_id) : null))
        .filter((id): id is string => id !== null),
    ),
  ];
  const variantsByShopifyId = new Map<string, typeof productVariants.$inferSelect>();
  if (shopifyVariantIds.length > 0) {
    const variantRows = await tx.select().from(productVariants)
      .where(and(eq(productVariants.orgId, orgId), inArray(productVariants.shopifyVariantId, shopifyVariantIds)));
    for (const row of variantRows) {
      if (row.shopifyVariantId) variantsByShopifyId.set(row.shopifyVariantId, row);
    }
  }

  for (const line of orderedLines) {
    const shopifyVariantId = line.variant_id ? shopifyGid('ProductVariant', line.variant_id) : null;
    const variant = shopifyVariantId ? variantsByShopifyId.get(shopifyVariantId) : undefined;

    if (!variant) {
      unmatchedSkus.push(line.sku ?? String(line.variant_id ?? 'unknown'));
      continue;
    }

    // Shopify's price is a decimal string already, in the same currency as
    // the order — parsed as fixed-point cents, never through a float.
    const priceMinor = shopifyMoneyToMinor(line.price);

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
    //
    // FOR UPDATE is what makes the sentence above true. The guarded UPDATE
    // that failed through to here is atomic, but this path is a read, a
    // decision in JavaScript, and then a write — CLAUDE.md rule 5's "if
    // above the query", and the UPDATE below cannot carry a `quantity >=`
    // guard because the whole point is to take LESS than was asked for.
    // Two concurrent orders/create deliveries for one variant therefore both
    // read the same quantity and both subtract it. Measured against real
    // Postgres, five concurrent takes of 2 against 5 on hand:
    //
    //   without FOR UPDATE   2/40 runs ended negative, as low as -2
    //   with FOR UPDATE      0/40, always exactly 0
    //
    // Locking the row serialises the read-modify-write, so the second caller
    // re-reads what the first left behind and floors correctly. Found when
    // this repository's own idempotency integration test caught it on a
    // contended database (-1 on hand) after passing by luck until then.
    const [item] = await tx.select({ id: inventoryItems.id, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, variant.id)))
      .for('update');

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

  return { resolvedItems, unmatchedSkus, discrepancies };
}

/**
 * Fan out one in-app notification per owner/admin that a Shopify order shorted
 * stock. This webhook has no authenticated caller (notifications.user_id is
 * NOT NULL, and there is no org-wide broadcast variant of this table), and a
 * stock shortfall is exactly the kind of thing whoever runs this org needs to
 * see promptly, not discover later as a mysteriously short shelf.
 */
async function notifyAdminsOfStockShortfall(
  tx: ShopifyWebhookTx,
  orgId: string,
  orderName: string,
  discrepancyCount: number,
): Promise<void> {
  const admins = await tx.select({ userId: orgMembers.userId }).from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), inArray(orgMembers.role, ['owner', 'admin'])));
  for (const { userId } of admins) {
    await tx.insert(notifications).values({
      orgId,
      userId,
      type: 'stock_discrepancy',
      title: `نقص في المخزون — طلب Shopify ${orderName}`,
      body: `${discrepancyCount} صنف/أصناف لم يتوفر لها مخزون كافٍ لتلبية الطلب بالكامل، وتم تطبيق الكمية المتاحة فقط.`,
      read: false,
    });
  }
}

shopifyWebhookRoute.post('/orders-create', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<ShopifyOrderPayload>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  const delivery = await claimDelivery(db, resolved, c, 'orders/create', payload);
  if (delivery.kind === 'processed') {
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
    // The order exists even though this exact delivery attempt's own row may
    // not say 'processed' (a concurrent request created it, or a prior
    // attempt crashed after inserting the order but before reaching the
    // processed-marker below) — backfill it now that the truth is known.
    await markDeliveryProcessed(db, delivery.kind === 'unrecorded' ? '' : delivery.deliveryId);
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }

  const status = mapFinancialStatusToOrderStatus(payload.financial_status, payload.cancelled_at);

  let validatedCurrency: string;
  try {
    validatedCurrency = assertSupportedCurrency((payload.currency || 'EGP').slice(0, 3).toUpperCase());
  } catch (err) {
    if (err instanceof UnsupportedCurrencyError) {
      if (delivery.kind !== 'unrecorded') await markDeliveryFailed(db, delivery.deliveryId, err);
      // Return 200 so Shopify doesn't retry a permanently unsupported currency order.
      // This matches the "we understood the webhook but can't safely process it" quarantine pattern.
      return c.json({ data: { skipped: 'unsupported_currency', message: err.message }, error: null, meta: null });
    }
    throw err;
  }

  let result;
  try {
    result = await withOrgContext(db, orgId, async (tx) => {
    const customerId = await findOrCreateCustomer(tx, orgId, payload.customer);

    // Resolve every line to a local variant, decrement stock (floored at
    // zero, shortfall recorded), and collect the unmatched SKUs for the
    // audit trail. See applyShopifyOrderLines for the deadlock-safe lock
    // ordering and the FOR UPDATE floor path.
    const { resolvedItems, unmatchedSkus, discrepancies } = await applyShopifyOrderLines(tx, orgId, payload);

    const seq = await nextDocumentNumber(tx, orgId, 'order');
    const orderNumber = formatDocumentNumber('order', seq);

    const totalMinor = shopifyMoneyToMinor(payload.total_price);

    const paymentMethod = payload.payment_gateway_names?.some(name => /cash on delivery|\bcod\b/i.test(name)) ? 'cod' : 'online';

    const insertedOrder = await withAudit(tx, async () => {
      const [row] = await tx.insert(orders).values({
        orgId,
        orderNumber,
        status,
        paymentMethod,
        totalAmountMinor: totalMinor,
        currency: validatedCurrency,
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

      await notifyAdminsOfStockShortfall(tx, orgId, payload.name, discrepancies.length);
    }

    const eventType = OUTBOX_EVENT_BY_STATUS[status];
    if (eventType) {
      const notification = await buildOrderNotification(tx, orgId, insertedOrder, eventType);
      if (notification) await emitOutboxEvent(tx, { orgId, eventType, payload: notification });
    }

    // Marked processed IN THE SAME transaction as the order/stock effect it
    // describes — either both commit together, or neither does, so a crash
    // here can never leave a 'processed' delivery row next to a missing
    // order (or vice versa).
    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);

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
      if (synced) {
        if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(db, delivery.deliveryId);
        return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
      }
    }
    if (delivery.kind !== 'unrecorded') await markDeliveryFailed(db, delivery.deliveryId, err);
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
  const delivery = await claimDelivery(db, resolved, c, 'orders/updated', payload);
  if (delivery.kind === 'processed') {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }
  const shopifyOrderId = shopifyGid('Order', payload.id);

  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.shopifyOrderId, shopifyOrderId)));
  // orders/updated can arrive before orders/create has been processed (no
  // ordering guarantee across topics) — nothing to update yet is not an
  // error, just early; orders/create will pick up the current state when it
  // lands. Deliberately not marking this delivery 'processed' here — leaving
  // it 'received' keeps it retryable rather than silently discarded.
  if (!existing) return c.json({ data: { skipped: 'order_not_found_yet' }, error: null, meta: null });

  const newStatus = mapFinancialStatusToOrderStatus(payload.financial_status, payload.cancelled_at);
  if (newStatus === existing.status) {
    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(db, delivery.deliveryId);
    return c.json({ data: { unchanged: true }, error: null, meta: null });
  }

  try {
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
    // A plain status update on an already-scoped order row is safely
    // re-runnable (retrying it just sets the same status again), so marking
    // processed just after commit — rather than inside the same
    // transaction, like orders-create's stock-affecting path — is fine here.
    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(db, delivery.deliveryId);
    return c.json({ data: jsonSafe(updated), error: null, meta: null });
  } catch (err) {
    if (delivery.kind !== 'unrecorded') await markDeliveryFailed(db, delivery.deliveryId, err);
    throw err;
  }
});

shopifyWebhookRoute.post('/orders-cancelled', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<{ id: number | string }>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  const delivery = await claimDelivery(db, resolved, c, 'orders/cancelled', payload);
  if (delivery.kind === 'processed') {
    return c.json({ data: { unchanged: true }, error: null, meta: null });
  }
  const shopifyOrderId = shopifyGid('Order', payload.id);

  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.shopifyOrderId, shopifyOrderId)));
  if (!existing || existing.status === 'cancelled') {
    // Already cancelled (or never existed) — the order's own status is the
    // real idempotency guard for the restock below, so this is safe
    // regardless of this delivery row's state; mark it processed too so it
    // stops showing as outstanding.
    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(db, delivery.deliveryId);
    return c.json({ data: { unchanged: true }, error: null, meta: null });
  }

  let updated;
  try {
    updated = await withOrgContext(db, orgId, (tx) => withAudit(tx, async () => {
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

    // One batched lookup for every line's inventory_items row instead of a
    // SELECT per line (previously N sequential round-trips for an N-line
    // order) — same inArray()+Map pattern orders-create already uses above.
    const variantIdsToRestock = [
      ...new Set(
        items
          .filter((item) => (appliedByVariant.get(item.variantId) ?? item.quantity) > 0)
          .map((item) => item.variantId),
      ),
    ];
    const invItemIdByVariant = new Map<string, string>();
    if (variantIdsToRestock.length > 0) {
      const invRows = await tx.select({ id: inventoryItems.id, variantId: inventoryItems.variantId })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.orgId, orgId), inArray(inventoryItems.variantId, variantIdsToRestock)));
      for (const row of invRows) invItemIdByVariant.set(row.variantId, row.id);
    }

    for (const item of items) {
      const restockQuantity = appliedByVariant.get(item.variantId) ?? item.quantity;
      if (restockQuantity <= 0) continue;

      const invItemId = invItemIdByVariant.get(item.variantId);
      if (!invItemId) continue;

      await tx.update(inventoryItems)
        .set({ quantity: sql`${inventoryItems.quantity} + ${restockQuantity}`, updatedAt: new Date() })
        .where(eq(inventoryItems.id, invItemId));

      await tx.insert(inventoryMovements).values({
        orgId,
        itemId: invItemId,
        type: 'in',
        quantity: restockQuantity,
        note: `Shopify order ${existing.orderNumber} cancelled — restocked`,
      });
    }

    // Same transaction as the cancellation + restock — commits or rolls
    // back together with the stock effect it describes.
    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);

    return row;
  }, {
    orgId,
    userId: null,
    action: 'SHOPIFY_ORDER_CANCEL',
    tableName: 'orders',
    changes: { oldStatus: existing.status, newStatus: 'cancelled' },
  }));
  } catch (err) {
    if (delivery.kind !== 'unrecorded') await markDeliveryFailed(db, delivery.deliveryId, err);
    throw err;
  }

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
  const delivery = await claimDelivery(db, resolved, c, 'customers/upsert', payload);
  if (delivery.kind === 'processed') {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }

  try {
    const customerId = await withOrgContext(db, orgId, async (tx) => {
      const id = await findOrCreateCustomer(tx, orgId, payload);
      if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);
      return id;
    });
    return c.json({ data: { customerId }, error: null, meta: null });
  } catch (err) {
    if (delivery.kind !== 'unrecorded') await markDeliveryFailed(db, delivery.deliveryId, err);
    throw err;
  }
});

shopifyWebhookRoute.post('/inventory-levels-update', verifyShopifyWebhook(), async (c: Context) => {
  const db = getDb();
  const resolved = await resolveWebhookOrg(c, db);
  if (!resolved) return c.json({ data: null, error: 'no_matching_connection', meta: null }, 404);
  const { orgId } = resolved;

  const bodyRaw = c.get('rawBody') as string;
  const payload = parseWebhookBody<{ inventory_item_id: number | string; location_id: number; available: number; updated_at: string }>(bodyRaw);
  if (!payload) return c.json({ data: null, error: 'invalid_json', meta: null }, 400);
  const delivery = await claimDelivery(db, resolved, c, 'inventory_levels/update', payload);
  if (delivery.kind === 'processed') {
    return c.json({ data: { alreadyProcessed: true }, error: null, meta: null });
  }
  const shopifyInventoryItemId = shopifyGid('InventoryItem', payload.inventory_item_id);

  const [variant] = await db.select().from(productVariants)
    .where(and(eq(productVariants.orgId, orgId), eq(productVariants.shopifyInventoryItemId, shopifyInventoryItemId)));

  // Not every Shopify inventory item is one this dashboard has pushed (e.g. a
  // product created directly in Shopify, outside the sync) — nothing to
  // reconcile against, not an error. A deliberate, valid terminal outcome,
  // not a failure — mark processed so a redelivery of this same id doesn't
  // re-run the (equally inconclusive) lookup.
  if (!variant) {
    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(db, delivery.deliveryId);
    return c.json({ data: { skipped: 'no_matching_variant' }, error: null, meta: null });
  }

  try {
    const skipped = await withOrgContext(db, orgId, async (tx) => {
    const [connection] = resolved.connectionId
      ? await tx.select({ inventoryLocationId: shopifyConnections.inventoryLocationId })
          .from(shopifyConnections)
          .where(and(eq(shopifyConnections.orgId, orgId), eq(shopifyConnections.id, resolved.connectionId)))
      : [];
    // The picker stores a GID; this webhook topic sends a numeric location ID.
    if (!connection?.inventoryLocationId ||
        connection.inventoryLocationId !== shopifyGid('Location', payload.location_id)) {
      if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);
      return 'location_not_selected' as const;
    }

    const eventAt = new Date(payload.updated_at);
    if (!Number.isFinite(eventAt.getTime())) throw new Error('Invalid Shopify inventory updated_at');

    const [item] = await tx.select().from(inventoryItems)
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.variantId, variant.id))).for('update');

    if (!item) {
      if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);
      return;
    }

    // Serialize freshness checks with other webhook and IRTH stock writes.
    if (item.lastShopifyInventoryEventAt && eventAt <= item.lastShopifyInventoryEventAt) {
      if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);
      return 'stale_event' as const;
    }

    // Matching reports also advance freshness, without touching stock or updatedAt.
    await tx.update(inventoryItems)
      .set({ lastShopifyInventoryEventAt: eventAt })
      .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, item.id)));

    if (payload.available !== item.quantity) {
      await tx.insert(inventoryLevelDiscrepancies).values({
        orgId,
        variantId: variant.id,
        locationId: connection.inventoryLocationId,
        irthQuantity: item.quantity,
        shopifyQuantity: payload.available,
        eventAt,
      });
    }

    if (delivery.kind !== 'unrecorded') await markDeliveryProcessed(tx, delivery.deliveryId);
  });
    if (skipped) return c.json({ data: { skipped }, error: null, meta: null });
  } catch (err) {
    if (delivery.kind !== 'unrecorded') await markDeliveryFailed(db, delivery.deliveryId, err);
    throw err;
  }

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

export { shopifyWebhookRoute, claimDelivery, markDeliveryProcessed, markDeliveryFailed };
export type { DeliveryClaim, ResolvedWebhookOrg };
