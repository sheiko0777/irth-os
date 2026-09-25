import {
  productVariants, inventoryItems, inventoryMovements, orgMembers, notifications,
  type DbTx, type OrderAddressSnapshot, type OrderBuyerSnapshot,
} from '@irth/db';
import { eq, and, sql, inArray } from 'drizzle-orm';

/**
 * The Shopify order import, shared by the orders/create webhook
 * (routes/webhooks/shopify.ts) and the blocked-order re-import job
 * (workers/outboxWorker.ts, event `shopify.order.reimport`).
 *
 * THE RULE THIS FILE ENFORCES: an imported order is complete or it is
 * blocked — never partial. The webhook used to `continue` past any line whose
 * variant had no local match and still insert the order with Shopify's full
 * total, so the admin showed an order whose items did not add up to its total
 * and gave no sign anything was missing. Now `findUnmappedLines` runs first;
 * if it finds anything the caller writes a blocked order with no items and no
 * stock movement, and the lines stay visible on `orders.source_payload`.
 */

export interface ShopifyLineItem {
  id?: number | string;
  sku: string | null;
  variant_id: number | string | null;
  product_id?: number | string | null;
  title?: string | null;
  variant_title?: string | null;
  name?: string | null;
  quantity: number;
  price: string;
}
export interface ShopifyCustomerPayload {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}
export interface ShopifyAddressPayload {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
}
interface ShopifyMoneySet {
  shop_money?: { amount?: string | null } | null;
}
export interface ShopifyOrderPayload {
  id: number | string;
  name: string; // "#1001"
  financial_status: string | null; // 'paid' | 'pending' | 'refunded' | ...
  cancelled_at: string | null;
  payment_gateway_names?: string[];
  currency: string;
  total_price: string;
  subtotal_price?: string | null;
  total_discounts?: string | null;
  total_tax?: string | null;
  total_shipping_price_set?: ShopifyMoneySet | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  customer?: ShopifyCustomerPayload | null;
  shipping_address?: ShopifyAddressPayload | null;
  billing_address?: ShopifyAddressPayload | null;
  line_items: ShopifyLineItem[];
}

/** Shopify's numeric/GID id, normalised to the string form this schema stores. */
export function shopifyGid(resource: string, id: number | string): string {
  const raw = String(id);
  return raw.startsWith('gid://') ? raw : `gid://shopify/${resource}/${raw}`;
}

export type ShopifyWebhookTx = DbTx;

/**
 * Shopify sends money as a decimal string ("1234.56") in the order's own
 * currency. Parse as fixed-point minor units — never through a float, per
 * CLAUDE.md rule 1.
 */
export function shopifyMoneyToMinor(decimal: string): bigint {
  const [whole, fraction = '0'] = decimal.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

export interface AppliedOrderLines {
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
export async function applyShopifyOrderLines(
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
export async function notifyAdminsOfStockShortfall(
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


/**
 * Money fields that are optional in the payload. A missing or malformed value
 * is recorded as unknown (null), never as zero — a zero discount and an
 * unreported discount are different facts.
 */
function optionalMoneyToMinor(decimal: string | null | undefined): bigint | null {
  if (decimal == null || !/^\d+(\.\d+)?$/.test(decimal.trim())) return null;
  return shopifyMoneyToMinor(decimal.trim());
}

/** Free text from the storefront, trimmed and bounded before it is stored. */
function text(value: string | null | undefined, max = 500): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function addressSnapshot(address: ShopifyAddressPayload | null | undefined): OrderAddressSnapshot | null {
  if (!address) return null;
  const name = text(address.name) ?? text([address.first_name, address.last_name].filter(Boolean).join(' '));
  return {
    name,
    phone: text(address.phone, 50),
    address1: text(address.address1),
    address2: text(address.address2),
    city: text(address.city, 200),
    province: text(address.province, 200),
    zip: text(address.zip, 50),
    country: text(address.country, 200),
  };
}

export interface ShopifyOrderSnapshot {
  buyer: OrderBuyerSnapshot;
  shippingAddress: OrderAddressSnapshot | null;
  billingAddress: OrderAddressSnapshot | null;
  subtotalMinor: bigint | null;
  discountMinor: bigint | null;
  shippingMinor: bigint | null;
  taxMinor: bigint | null;
  customerNote: string | null;
}

/**
 * Everything the order page needs to show who bought what and where it goes,
 * captured at order time. Customer records change later; the order must keep
 * what was true when it was placed.
 */
export function snapshotShopifyOrder(payload: ShopifyOrderPayload): ShopifyOrderSnapshot {
  const customerName = text([payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' '));
  return {
    buyer: {
      name: customerName ?? text(payload.shipping_address?.name) ?? text(payload.billing_address?.name),
      email: text(payload.email ?? payload.customer?.email, 320),
      phone: text(payload.phone ?? payload.customer?.phone ?? payload.shipping_address?.phone, 50),
    },
    shippingAddress: addressSnapshot(payload.shipping_address),
    billingAddress: addressSnapshot(payload.billing_address),
    subtotalMinor: optionalMoneyToMinor(payload.subtotal_price),
    discountMinor: optionalMoneyToMinor(payload.total_discounts),
    shippingMinor: optionalMoneyToMinor(payload.total_shipping_price_set?.shop_money?.amount),
    taxMinor: optionalMoneyToMinor(payload.total_tax),
    customerNote: text(payload.note, 2000),
  };
}

/** A line that could not be mapped to a local variant, as shown to the operator. */
export interface UnmappedLine {
  label: string;
  shopifyVariantId: string | null;
  quantity: number;
}

function lineLabel(line: ShopifyLineItem): string {
  return text(line.name) ?? text(line.title) ?? line.sku ?? String(line.variant_id ?? 'unknown');
}

/**
 * Every line with no local variant, BEFORE anything is written. A line with no
 * Shopify variant id at all (a custom item) can never match and is reported
 * too. Read-only: no row locks, no stock movement.
 */
export async function findUnmappedLines(
  tx: ShopifyWebhookTx,
  orgId: string,
  payload: ShopifyOrderPayload,
): Promise<UnmappedLine[]> {
  const ids = [
    ...new Set(
      payload.line_items
        .map((line) => (line.variant_id ? shopifyGid('ProductVariant', line.variant_id) : null))
        .filter((id): id is string => id !== null),
    ),
  ];
  const known = new Set<string>();
  if (ids.length > 0) {
    const rows = await tx.select({ shopifyVariantId: productVariants.shopifyVariantId }).from(productVariants)
      .where(and(eq(productVariants.orgId, orgId), inArray(productVariants.shopifyVariantId, ids)));
    for (const row of rows) if (row.shopifyVariantId) known.add(row.shopifyVariantId);
  }
  return payload.line_items
    .map((line) => ({ line, gid: line.variant_id ? shopifyGid('ProductVariant', line.variant_id) : null }))
    .filter(({ gid }) => gid === null || !known.has(gid))
    .map(({ line, gid }) => ({ label: lineLabel(line), shopifyVariantId: gid, quantity: line.quantity }));
}

/** The reason text stored on a blocked order and shown on its page. */
export function blockedReasonFor(unmapped: UnmappedLine[]): string {
  const labels = unmapped.map((u) => u.label).slice(0, 10).join('، ');
  const more = unmapped.length > 10 ? ` (+${unmapped.length - 10})` : '';
  return `بنود غير مربوطة بمنتج في النظام: ${labels}${more}`;
}

/** One in-app notification per owner/admin that an imported order is blocked. */
export async function notifyAdminsOfBlockedImport(
  tx: ShopifyWebhookTx,
  orgId: string,
  orderName: string,
  unmappedCount: number,
): Promise<void> {
  const admins = await tx.select({ userId: orgMembers.userId }).from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), inArray(orgMembers.role, ['owner', 'admin'])));
  for (const { userId } of admins) {
    await tx.insert(notifications).values({
      orgId,
      userId,
      type: 'order_import_blocked',
      title: `طلب Shopify ${orderName} متوقف`,
      body: `${unmappedCount} بند/بنود غير مربوطة بمنتج في النظام. اربط البنود من صفحة الطلب ثم أعد الاستيراد.`,
      read: false,
    });
  }
}
