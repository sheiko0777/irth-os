import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  InsufficientStockError, MAX_IDEMPOTENCY_KEY_LENGTH, customers, formatDocumentNumber, inventoryItems, isPriceListActive,
  nextDocumentNumber, orders, placeOrder, priceLists, productVariants, products, salesQuoteItems, salesQuotes, totalsOf,
  unitPrice, withAudit, type DbTx,
} from '@irth/db';
import { router, requirePermission, type Context } from '../trpc';
import { me, myCustomer, priceLines, usablePriceList } from '../salesSupport';

/**
 * مبيعاتي (PR-2b): a sales rep's book — their customers, the orders they place
 * for them and the quotes they prepare, at the price lists they may use.
 *
 * Every query is limited to the caller here AND by 0078 inside ctx.withOrg.
 * Prices are computed on the server from the price list (salesPricing.ts),
 * never taken from the client. Orders go through @irth/db's placeOrder, the
 * same implementation as apps/api, so a rep's order takes stock exactly like
 * any other. The mutations that create orders or quotes take an idempotency
 * key, and return no bigint (a replay is read back from jsonb).
 */

const keyInput = z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH);
const linesInput = z.array(z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive().max(10_000),
})).min(1).max(100);

type Ctx = Pick<Context, 'access' | 'orgId' | 'userId'>;

function snapshotsOf(customer: { name: string; email: string | null; phone: string | null; address: string | null }) {
  return {
    buyer: { name: customer.name, email: customer.email, phone: customer.phone },
    shippingAddress: {
      name: customer.name, phone: customer.phone, address1: customer.address,
      address2: null, city: null, province: null, zip: null, country: null,
    },
  };
}

function stockRefusal(err: unknown): never {
  if (err instanceof InsufficientStockError) {
    throw new TRPCError({ code: 'CONFLICT', message: 'الكمية المطلوبة مش متاحة في المخزون.' });
  }
  throw err;
}

async function place(
  tx: DbTx, ctx: Ctx, customer: Parameters<typeof snapshotsOf>[0] & { id: string },
  lines: ReadonlyArray<{ variantId: string; quantity: number; listPriceMinor: bigint; unitPriceMinor: bigint }>,
  paymentMethod: 'cod' | 'online', note: string | null, extra: Record<string, unknown>,
) {
  const totals = totalsOf(lines);
  return placeOrder(tx, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, priceMinor: l.unitPriceMinor })),
    currency: 'EGP',
    totalAmountMinor: totals.totalMinor,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    paymentMethod,
    customerId: customer.id,
    createdByMemberId: me(ctx),
    customerNote: note,
    ...snapshotsOf(customer),
    auditChanges: { via: 'sales', customerId: customer.id, ...extra },
  });
}

export const salesRouter = router({
  /** Price lists I may sell at, active now. */
  priceLists: requirePermission('sales', 'view')
    .query(async ({ ctx }) => {
      const allowed = ctx.access.scopes.pricelist;
      const rows = await ctx.withOrg((tx) => tx.select({
        id: priceLists.id, name: priceLists.name, discountBp: priceLists.discountBp,
        startDate: priceLists.startDate, endDate: priceLists.endDate, currency: priceLists.currency,
      })
        .from(priceLists)
        .where(and(
          eq(priceLists.orgId, ctx.orgId),
          eq(priceLists.currency, 'EGP'),
          allowed.length > 0 ? inArray(priceLists.id, [...allowed]) : undefined,
        ))
        .orderBy(asc(priceLists.name)));
      const now = new Date();
      return { data: rows.filter((l) => isPriceListActive(l, now)), error: null, meta: null };
    }),

  /** Products I can sell, with stock and my price at the chosen list. */
  catalog: requirePermission('sales', 'view')
    .input(z.object({ priceListId: z.string().uuid().nullable().default(null), search: z.string().trim().max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withOrg(async (tx) => {
        const list = await usablePriceList(tx, ctx, input.priceListId, new Date());
        const variants = await tx.select({
          id: productVariants.id, productId: productVariants.productId, sku: productVariants.sku, name: productVariants.name,
          productName: products.name, priceMinor: productVariants.priceMinor, productPriceMinor: products.priceMinor,
          available: sql<number>`COALESCE(${inventoryItems.quantity}, 0)::int`,
        })
          .from(productVariants)
          .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.orgId, ctx.orgId)))
          .leftJoin(inventoryItems, and(eq(inventoryItems.variantId, productVariants.id), eq(inventoryItems.orgId, ctx.orgId)))
          .where(and(
            eq(productVariants.orgId, ctx.orgId),
            eq(products.status, 'active'),
            eq(products.currency, 'EGP'),
            input.search ? or(
              ilike(products.name, `%${input.search}%`), ilike(productVariants.sku, `%${input.search}%`), ilike(productVariants.name, `%${input.search}%`),
            ) : undefined,
          ))
          .orderBy(asc(products.name), asc(productVariants.sku))
          .limit(50);
        return variants.map((v) => ({
          id: v.id, sku: v.sku, name: v.name, productName: v.productName, available: v.available,
          ...unitPrice(v, list),
        }));
      });
      return { data: rows, error: null, meta: null };
    }),

  customers: requirePermission('sales', 'view')
    .input(z.object({ search: z.string().trim().max(100).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.withOrg((tx) => tx.select({
        id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, address: customers.address,
      })
        .from(customers)
        .where(and(
          eq(customers.orgId, ctx.orgId),
          eq(customers.salesRepMemberId, me(ctx)),
          input.search ? or(ilike(customers.name, `%${input.search}%`), ilike(customers.phone, `%${input.search}%`)) : undefined,
        ))
        .orderBy(asc(customers.name))
        .limit(200));
      return { data: rows, error: null, meta: null };
    }),

  /** A new customer of mine. */
  addCustomer: requirePermission('sales', 'customers')
    .input(z.object({
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().email().max(200).optional(),
      address: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [c] = await tx.insert(customers).values({
          orgId: ctx.orgId, name: input.name, phone: input.phone ?? null, email: input.email ?? null,
          address: input.address ?? null, salesRepMemberId: me(ctx),
        }).returning({ id: customers.id, name: customers.name });
        return c;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'SALES_REP_ADD_CUSTOMER', tableName: 'customers', changes: { name: input.name } }));
      return { data: row, error: null, meta: null };
    }),

  /** Orders I placed, and my customers' orders. */
  orders: requirePermission('sales', 'view')
    .query(async ({ ctx }) => {
      const mine = me(ctx);
      const rows = await ctx.withOrg((tx) => tx.select({
        id: orders.id, orderNumber: orders.orderNumber, status: orders.status, totalAmountMinor: orders.totalAmountMinor,
        currency: orders.currency, createdAt: orders.createdAt, customerName: customers.name,
      })
        .from(orders)
        .leftJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.orgId, ctx.orgId)))
        .where(and(eq(orders.orgId, ctx.orgId), or(eq(orders.createdByMemberId, mine), eq(customers.salesRepMemberId, mine))))
        .orderBy(desc(orders.createdAt))
        .limit(100));
      return { data: rows, error: null, meta: null };
    }),

  quotes: requirePermission('sales', 'view')
    .query(async ({ ctx }) => {
      const rows = await ctx.withOrg((tx) => tx.select({
        quote: salesQuotes, customerName: customers.name,
      })
        .from(salesQuotes)
        .leftJoin(customers, and(eq(customers.id, salesQuotes.customerId), eq(customers.orgId, ctx.orgId)))
        .where(and(eq(salesQuotes.orgId, ctx.orgId), eq(salesQuotes.createdByMemberId, me(ctx))))
        .orderBy(desc(salesQuotes.createdAt))
        .limit(100));
      return { data: rows, error: null, meta: null };
    }),

  /** Place an order for one of my customers, priced on the server. */
  placeOrder: requirePermission('sales', 'order')
    .input(z.object({
      customerId: z.string().uuid(),
      priceListId: z.string().uuid().nullable().default(null),
      lines: linesInput,
      paymentMethod: z.enum(['cod', 'online']).default('cod'),
      note: z.string().trim().max(500).optional(),
      idempotencyKey: keyInput,
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('sales.placeOrder', input.idempotencyKey, input, async () => {
        const order = await ctx.withOrg(async (tx) => {
          const customer = await myCustomer(tx, ctx, input.customerId);
          const list = await usablePriceList(tx, ctx, input.priceListId, new Date());
          const lines = await priceLines(tx, ctx, list, input.lines);
          return place(tx, ctx, customer, lines, input.paymentMethod, input.note ?? null, { priceListId: list?.id ?? null });
        }).catch(stockRefusal);
        return { data: { id: order.id, orderNumber: order.orderNumber }, error: null, meta: null };
      })),

  /** A priced proposal: no stock moves, nothing posts. */
  createQuote: requirePermission('sales', 'quote')
    .input(z.object({
      customerId: z.string().uuid(),
      priceListId: z.string().uuid().nullable().default(null),
      lines: linesInput,
      validDays: z.number().int().min(1).max(60).default(7),
      notes: z.string().trim().max(1000).optional(),
      idempotencyKey: keyInput,
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('sales.createQuote', input.idempotencyKey, input, async () => {
        const quote = await ctx.withOrg(async (tx) => {
          const customer = await myCustomer(tx, ctx, input.customerId);
          const now = new Date();
          const list = await usablePriceList(tx, ctx, input.priceListId, now);
          const lines = await priceLines(tx, ctx, list, input.lines);
          const totals = totalsOf(lines);
          const quoteNumber = formatDocumentNumber('quote', await nextDocumentNumber(tx, ctx.orgId, 'quote'));
          return withAudit(tx, async () => {
            const [q] = await tx.insert(salesQuotes).values({
              orgId: ctx.orgId, quoteNumber, customerId: customer.id, createdByMemberId: me(ctx), priceListId: list?.id ?? null,
              currency: 'EGP', subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, totalMinor: totals.totalMinor,
              validUntil: new Date(now.getTime() + input.validDays * 86_400_000), notes: input.notes ?? null,
            }).returning({ id: salesQuotes.id, quoteNumber: salesQuotes.quoteNumber });
            await tx.insert(salesQuoteItems).values(lines.map((l) => ({
              orgId: ctx.orgId, quoteId: q.id, variantId: l.variantId, quantity: l.quantity,
              listPriceMinor: l.listPriceMinor, unitPriceMinor: l.unitPriceMinor,
            })));
            return q;
          }, { orgId: ctx.orgId, userId: ctx.userId, action: 'SALES_QUOTE_CREATED', tableName: 'sales_quotes', changes: { quoteNumber, customerId: customer.id } });
        });
        return { data: quote, error: null, meta: null };
      })),

  /**
   * A still-valid open quote becomes an order at the quoted prices. The quote
   * moves open → converted in the UPDATE's WHERE, in the same transaction as
   * the order, so it converts once however often this is retried.
   */
  convertQuote: requirePermission('sales', 'order')
    .input(z.object({ quoteId: z.string().uuid(), paymentMethod: z.enum(['cod', 'online']).default('cod'), idempotencyKey: keyInput }))
    .mutation(async ({ ctx, input }) =>
      ctx.idempotent('sales.convertQuote', input.idempotencyKey, input, async () => {
        const order = await ctx.withOrg(async (tx) => {
          const [quote] = await tx.select().from(salesQuotes)
            .where(and(eq(salesQuotes.id, input.quoteId), eq(salesQuotes.orgId, ctx.orgId), eq(salesQuotes.createdByMemberId, me(ctx))))
            .for('update');
          if (!quote) throw new TRPCError({ code: 'NOT_FOUND' });
          if (quote.status !== 'open') throw new TRPCError({ code: 'CONFLICT', message: 'عرض السعر اتحوّل أو اتلغى قبل كده.' });
          if (quote.validUntil < new Date()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'عرض السعر انتهت صلاحيته.' });
          const customer = await myCustomer(tx, ctx, quote.customerId);
          const items = await tx.select().from(salesQuoteItems)
            .where(and(eq(salesQuoteItems.quoteId, quote.id), eq(salesQuoteItems.orgId, ctx.orgId)));
          const placed = await place(tx, ctx, customer, items, input.paymentMethod, quote.notes, { quoteNumber: quote.quoteNumber });
          const converted = await tx.update(salesQuotes)
            .set({ status: 'converted', convertedOrderId: placed.id, updatedAt: sql`now()` })
            .where(and(eq(salesQuotes.id, quote.id), eq(salesQuotes.orgId, ctx.orgId), eq(salesQuotes.status, 'open'), gte(salesQuotes.validUntil, sql`now()`)))
            .returning({ id: salesQuotes.id });
          if (converted.length === 0) throw new TRPCError({ code: 'CONFLICT', message: 'عرض السعر اتغيّر. حدّث الصفحة.' });
          return placed;
        }).catch(stockRefusal);
        return { data: { id: order.id, orderNumber: order.orderNumber }, error: null, meta: null };
      })),

  cancelQuote: requirePermission('sales', 'quote')
    .input(z.object({ quoteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.withOrg((tx) => withAudit(tx, async () => {
        const [q] = await tx.update(salesQuotes)
          .set({ status: 'cancelled', updatedAt: sql`now()` })
          .where(and(eq(salesQuotes.id, input.quoteId), eq(salesQuotes.orgId, ctx.orgId), eq(salesQuotes.createdByMemberId, me(ctx)), eq(salesQuotes.status, 'open')))
          .returning({ id: salesQuotes.id });
        if (!q) throw new TRPCError({ code: 'CONFLICT', message: 'عرض السعر مش مفتوح.' });
        return q;
      }, { orgId: ctx.orgId, userId: ctx.userId, action: 'SALES_QUOTE_CANCELLED', tableName: 'sales_quotes', changes: { quoteId: input.quoteId } }));
      return { data: row, error: null, meta: null };
    }),
});
