import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import {
  customers, isPriceListActive, priceListItems, priceLists, productVariants, products, unitPrice,
  type DbTx, type PriceListRule, type PricedLine,
} from '@irth/db';
import type { Context } from './trpc';

/**
 * Loading and pricing for a sales rep's orders and quotes (PR-2b). Every read
 * runs in the caller's scoped transaction, so 0076/0078's policies apply on
 * top of the explicit conditions here: a rep prices only products of their
 * brands, at price lists they may use, for customers who are theirs.
 */

type Ctx = Pick<Context, 'access' | 'orgId'>;

export function me(ctx: Ctx): string {
  // Not a permission question: the permission was already checked. An access
  // with no membership row (system work) has no book of its own to act on.
  if (!ctx.access.memberId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No membership to act as.' });
  return ctx.access.memberId;
}

/** One of my customers, or NOT_FOUND — whoever else they belong to. */
export async function myCustomer(tx: DbTx, ctx: Ctx, customerId: string) {
  const [customer] = await tx.select().from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, ctx.orgId), eq(customers.salesRepMemberId, me(ctx))));
  if (!customer) throw new TRPCError({ code: 'NOT_FOUND', message: 'العميل مش من عملائك.' });
  return customer;
}

/**
 * A price list this member may sell at, active now, in EGP — or null for
 * list prices. The member's price-list scope is checked here and by 0078.
 */
export async function usablePriceList(tx: DbTx, ctx: Ctx, priceListId: string | null, at: Date): Promise<PriceListRule | null> {
  if (!priceListId) return null;
  const allowed = ctx.access.scopes.pricelist;
  if (allowed.length > 0 && !allowed.includes(priceListId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'قائمة الأسعار دي مش مسموحة لك.' });
  }
  const [list] = await tx.select().from(priceLists)
    .where(and(eq(priceLists.id, priceListId), eq(priceLists.orgId, ctx.orgId)));
  if (!list) throw new TRPCError({ code: 'NOT_FOUND', message: 'قائمة الأسعار غير موجودة.' });
  if (!isPriceListActive(list, at)) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'قائمة الأسعار مش سارية دلوقتي.' });
  if (list.currency !== 'EGP') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'قائمة الأسعار بعملة غير الجنيه.' });
  const items = await tx.select({ productId: priceListItems.productId, variantId: priceListItems.variantId, priceMinor: priceListItems.priceMinor })
    .from(priceListItems)
    .where(and(eq(priceListItems.priceListId, list.id), eq(priceListItems.orgId, ctx.orgId)));
  return { id: list.id, currency: list.currency, discountBp: list.discountBp, startDate: list.startDate, endDate: list.endDate, items };
}

/** Prices each requested line; NOT_FOUND for a variant the caller cannot see. */
export async function priceLines(
  tx: DbTx, ctx: Ctx, list: PriceListRule | null, requested: ReadonlyArray<{ variantId: string; quantity: number }>,
): Promise<PricedLine[]> {
  const ids = [...new Set(requested.map((l) => l.variantId))];
  const rows = await tx.select({
    id: productVariants.id,
    productId: productVariants.productId,
    priceMinor: productVariants.priceMinor,
    productPriceMinor: products.priceMinor,
    productCurrency: products.currency,
    productStatus: products.status,
  })
    .from(productVariants)
    .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.orgId, ctx.orgId)))
    .where(and(eq(productVariants.orgId, ctx.orgId), inArray(productVariants.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return requested.map((line) => {
    const v = byId.get(line.variantId);
    if (!v || v.productStatus !== 'active' || v.productCurrency !== 'EGP') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'منتج غير متاح للبيع.' });
    }
    return { variantId: line.variantId, quantity: line.quantity, ...unitPrice(v, list) };
  });
}
