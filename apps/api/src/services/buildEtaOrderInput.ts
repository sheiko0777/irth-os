import { db } from '../db';
import { orders, orderItems, productVariants, products, customers } from '@irth/db';
import { eq, and } from 'drizzle-orm';
import type { EtaOrderInput } from './eta';

/**
 * Assembles the real order/line/receiver data issueInvoice needs, from the
 * order id alone. Shared by routes/orders.ts and routes/webhooks/bosta.ts,
 * which used to each carry their own identical copy.
 *
 * A THIRD, separate copy still exists in
 * apps/admin/src/server/routers/eta.ts — that one is in a different workspace
 * app and cannot share code with apps/api without a `pnpm install` this
 * environment cannot run (documented in that file's own comment). itemCode is
 * the SKU, not an ETA-conformant code; the schema has no national-ID field
 * for the >150,000 EGP threshold — see that file's fuller comment on both.
 *
 * Not part of services/eta.ts: that file is deliberately free of any
 * `@irth/db` import (see its own file-banner comment), and this helper needs
 * `@irth/db` for its queries.
 *
 * Returns `null` when the order has no items to declare.
 */
export async function buildEtaOrderInput(
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
