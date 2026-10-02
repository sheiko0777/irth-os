import { and, eq } from 'drizzle-orm';
import { orders, orderItems, productVariants, products } from './schema';
import { customers } from './schema/customers';
import type { DbTx } from './index';

/**
 * Assembles the real order/line/receiver data ETA invoice issuance needs,
 * from an order id alone.
 *
 * Lives here, not in packages/domain/src/eta.ts, for the reverse reason that
 * file explains its own home: this function needs `@irth/db`'s schema and a
 * db handle, and `packages/domain` has zero dependencies by design. The
 * return shape is declared locally rather than imported from
 * `@irth/domain`'s `EtaOrderInput` — the two are structurally identical by
 * construction, and duplicating a plain data-shape interface costs far less
 * than adding a new cross-package dependency edge for a type alone.
 *
 * Previously three independent copies of this same query existed:
 * apps/api/src/services/buildEtaOrderInput.ts, and an inline copy in
 * apps/admin/src/server/routers/eta.ts. Both are now callers of this one.
 *
 * Returns `null` when the order does not exist or has no items to declare.
 */
export interface EtaOrderInputShape {
  id: string;
  orgId: string;
  orderNumber: string;
  currency?: string;
  customerName?: string | null;
  items: {
    description: string;
    itemCode: string;
    quantity: number;
    unitPriceMinor: bigint;
  }[];
}

export async function buildEtaOrderInput(
  db: Pick<DbTx, 'select'>,
  orgId: string,
  orderId: string,
): Promise<EtaOrderInputShape | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  if (!order) return null;

  // Real invoice lines, not one synthetic "Order Items" row: each order_item
  // becomes its own ETA line, priced at what was actually charged
  // (order_items.price_minor), described with the real product name and SKU
  // as the item code.
  //
  // itemCode uses the SKU because nothing in this schema stores a GS1/EGS/
  // GPC-format ETA item code — the SKU is real and traceable to a specific
  // product, but it is NOT itself an ETA-conformant code. Flagged rather
  // than silently assumed correct.
  //
  // LEFT joins (0086): a custom_nonstock line has no variant, but it was
  // charged, so it must still be declared — an inner join would silently drop
  // it and under-declare the invoice. It is described from its own snapshot.
  const rawLines = await db
    .select({
      quantity: orderItems.quantity,
      priceMinor: orderItems.priceMinor,
      productName: products.name,
      sku: productVariants.sku,
      title: orderItems.title,
      skuSnapshot: orderItems.skuSnapshot,
    })
    .from(orderItems)
    .leftJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .leftJoin(products, eq(productVariants.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  if (rawLines.length === 0) return null;

  const lineRows = rawLines.map((r) => {
    const productName = r.productName ?? r.title;
    const sku = r.sku ?? r.skuSnapshot;
    if (productName == null || sku == null) {
      // Refuse rather than invent a description or item code for a tax filing.
      throw new Error(`order ${orderId} has a line with no product name/title or SKU; cannot build its ETA invoice`);
    }
    return { quantity: r.quantity, priceMinor: r.priceMinor, productName, sku };
  });

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
    id: order.id,
    orgId,
    orderNumber: order.orderNumber,
    currency: order.currency,
    customerName,
    items: lineRows.map((r) => ({
      description: r.productName,
      itemCode: r.sku,
      quantity: r.quantity,
      unitPriceMinor: r.priceMinor,
    })),
  };
}
