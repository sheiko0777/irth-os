import { router, requirePermission } from '../trpc';
import { orders, orderItems, products, productVariants, journalLines, journalEntries, accounts, ACCOUNT_CODES, type DbTx } from '@irth/db';
import { eq, and, desc, count, sum, gte, lte } from 'drizzle-orm';
import { EGYPT_VAT_BP, divideRoundHalfEven, formatMoney, fromMinor, netOfTax, taxIncludedIn } from '@irth/domain';
import { z } from 'zod';

/**
 * One matcher/handler pair per askAi intent, checked in order -- adding an
 * intent is one array entry instead of another branch in a growing
 * if/else-if chain. Each handler runs its own real query; there is no
 * separate "displayed SQL" string alongside it (the previous version built
 * one for the UI to show as "the query that ran", but it never actually
 * ran and had already drifted from the real Drizzle query it stood next
 * to -- e.g. the top-products handler's shown string had no join condition
 * spelled out the way the real query did).
 */
const ASK_AI_INTENTS: Array<{
  matches: (q: string) => boolean;
  handle: (db: Pick<DbTx, 'select'>, orgId: string) => Promise<string>;
}> = [
  {
    matches: (q) => q.includes('اكثر') || q.includes('top') || q.includes('best'),
    handle: async (db, orgId) => {
      const topProducts = await db
        .select({ name: products.name, orderCount: count(orderItems.id) })
        .from(orderItems)
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(eq(orders.orgId, orgId))
        .groupBy(products.name)
        .orderBy(desc(count(orderItems.id)))
        .limit(5);

      if (topProducts.length === 0) return 'لا توجد منتجات مباعة.';
      return 'أكثر 5 منتجات مبيعاً:\n' + topProducts
        .map((p: { name: string | null; orderCount: number }, i: number) => `${i + 1}. ${p.name} (${p.orderCount} طلب)`)
        .join('\n');
    },
  },
  {
    matches: (q) => q.includes('revenue') || q.includes('ايراد'),
    handle: async (db, orgId) => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const revRes = await db
        .select({ total: sum(orders.totalAmountMinor) })
        .from(orders)
        .where(and(
          eq(orders.orgId, orgId),
          eq(orders.status, 'delivered'),
          gte(orders.createdAt, thirtyDaysAgo)
        ));

      const rev = fromMinor(BigInt((revRes[0]?.total as string | null) ?? '0'));
      return `إجمالي الإيرادات في آخر 30 يوماً: ${formatMoney(rev)}`;
    },
  },
  {
    matches: (q) => q.includes('pending') || q.includes('معلق'),
    handle: async (db, orgId) => {
      const pendRes = await db
        .select({ count: count() })
        .from(orders)
        .where(and(eq(orders.orgId, orgId), eq(orders.status, 'pending')));

      return `عدد الطلبات المعلقة: ${pendRes[0]?.count ?? 0}`;
    },
  },
];

/** Falls back to today's order count when no intent above matches. */
async function askAiDefault(db: Pick<DbTx, 'select'>, orgId: string): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayRes = await db
    .select({ count: count() })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, startOfDay)));

  return `إجمالي طلبات اليوم: ${todayRes[0]?.count ?? 0}`;
}

/** debit-credit for a debit-normal account, credit-debit for a credit-normal one — the account's own balance in its own natural sign. */
function accountBalanceMinor(row: { normalBalance: 'debit' | 'credit'; debit: string | null; credit: string | null }): bigint {
    const debit = BigInt(row.debit ?? '0');
    const credit = BigInt(row.credit ?? '0');
    return row.normalBalance === 'debit' ? debit - credit : credit - debit;
}

export const financeRouter = router({
    pnl: requirePermission('finance', 'view')
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            end.setHours(23, 59, 59, 999);

            // What this replaced: `totalRevenue` was SUM(orders.total_amount_minor)
            // for delivered orders — gross sales wearing a P&L's name. No COGS, no
            // returns, no expenses; "profit" was never actually computed. This
            // reads the double-entry ledger (packages/db/src/ledger.ts) instead,
            // which is fed by postJournalEntry calls at order.delivered,
            // return.refunded, purchasing.receive and stocktaking.complete.
            //
            // Grouped by account CODE, not just type: 4010 (Sales Revenue) and
            // 4020 (Sales Returns & Allowances) are both type=revenue but need
            // reporting separately, and summing all `expense`-type accounts
            // together would silently merge COGS (5010) with Inventory Variance
            // (5020) into one figure.
            const [ledgerRows, totalOrdersQuery, cancelledQuery, pendingQuery] = await Promise.all([
                ctx.db
                    .select({
                        code: accounts.code,
                        normalBalance: accounts.normalBalance,
                        debit: sum(journalLines.debitMinor),
                        credit: sum(journalLines.creditMinor),
                    })
                    .from(journalLines)
                    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
                    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
                    .where(and(
                        eq(journalLines.orgId, ctx.orgId),
                        gte(journalEntries.entryDate, start),
                        lte(journalEntries.entryDate, end),
                    ))
                    .groupBy(accounts.code, accounts.normalBalance),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end)
                    )),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end),
                        eq(orders.status, 'cancelled')
                    )),
                ctx.db
                    .select({ count: count() })
                    .from(orders)
                    .where(and(
                        eq(orders.orgId, ctx.orgId),
                        gte(orders.createdAt, start),
                        lte(orders.createdAt, end),
                        eq(orders.status, 'pending')
                    )),
            ]);

            const byCode = new Map(ledgerRows.map((r) => [r.code, accountBalanceMinor(r)]));
            const zero = BigInt(0);

            const grossRevenueMinor = byCode.get(ACCOUNT_CODES.SALES_REVENUE) ?? zero;
            // Debit-normal (a contra-revenue account), so its balance is already
            // positive when returns have been posted — no sign flip needed here.
            const returnsMinor = byCode.get(ACCOUNT_CODES.SALES_RETURNS) ?? zero;
            const netRevenueMinor = grossRevenueMinor - returnsMinor;
            const cogsMinor = byCode.get(ACCOUNT_CODES.COGS) ?? zero;
            const grossProfitMinor = netRevenueMinor - cogsMinor;
            // Debit-normal: positive means a net shortage (a loss, so it reduces
            // income below); negative means a net overage (a gain).
            const inventoryVarianceMinor = byCode.get(ACCOUNT_CODES.INVENTORY_VARIANCE) ?? zero;
            const netIncomeMinor = grossProfitMinor - inventoryVarianceMinor;

            const totalOrders = totalOrdersQuery[0]?.count ?? 0;
            const avgOrderValueMinor = totalOrders > 0
                ? divideRoundHalfEven(netRevenueMinor, BigInt(totalOrders))
                : zero;
            const cancelledOrders = cancelledQuery[0]?.count ?? 0;
            const pendingOrders = pendingQuery[0]?.count ?? 0;

            return {
                data: {
                    // Kept as the name the finance page already reads — its
                    // MEANING changed from gross order sums to net ledger revenue.
                    totalRevenue: fromMinor(netRevenueMinor),
                    totalOrders,
                    avgOrderValue: fromMinor(avgOrderValueMinor),
                    cancelledOrders,
                    pendingOrders,
                    // The breakdown a P&L actually needs, all from the ledger.
                    grossRevenue: fromMinor(grossRevenueMinor),
                    returns: fromMinor(returnsMinor),
                    netRevenue: fromMinor(netRevenueMinor),
                    cogs: fromMinor(cogsMinor),
                    grossProfit: fromMinor(grossProfitMinor),
                    inventoryVariance: fromMinor(inventoryVarianceMinor),
                    netIncome: fromMinor(netIncomeMinor),
                    startDate: input.startDate,
                    endDate: input.endDate
                },
                error: null,
                meta: null
            };
        }),

    codReconciliation: requirePermission('finance', 'view')
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            end.setHours(23, 59, 59, 999);

            const rows = await ctx.db
                .select({
                    orderId: orders.id,
                    orderNumber: orders.orderNumber,
                    amount: orders.totalAmountMinor,
                    status: orders.status,
                    createdAt: orders.createdAt,
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, start),
                    lte(orders.createdAt, end),
                    eq(orders.status, 'delivered'),
                    eq(orders.paymentMethod, 'cod')
                ))
                .orderBy(desc(orders.createdAt));

            return {
                data: rows,
                error: null,
                meta: null
            };
        }),

    vatReport: requirePermission('finance', 'view')
        .input(z.object({
            startDate: z.string(),
            endDate: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            end.setHours(23, 59, 59, 999);

            const result = await ctx.db
                .select({
                    total: sum(orders.totalAmountMinor),
                    count: count(),
                })
                .from(orders)
                .where(and(
                    eq(orders.orgId, ctx.orgId),
                    gte(orders.createdAt, start),
                    lte(orders.createdAt, end),
                    eq(orders.status, 'delivered')
                ));

            const grossRevenue = fromMinor(BigInt((result[0]?.total as string | null) ?? '0'));
            const orderCount = result[0]?.count ?? 0;
            const vatAmount = taxIncludedIn(grossRevenue, EGYPT_VAT_BP);
            const netRevenue = netOfTax(grossRevenue, EGYPT_VAT_BP);

            return {
                data: {
                    grossRevenue,
                    vatAmount,
                    netRevenue,
                    orderCount,
                    startDate: input.startDate,
                    endDate: input.endDate
                },
                error: null,
                meta: null
            };
        }),

    askAi: requirePermission('finance', 'view')
        .input(z.object({
            question: z.string().max(500),
        }))
        .mutation(async ({ ctx, input }) => {
            const q = input.question.toLowerCase();
            const intent = ASK_AI_INTENTS.find((candidate) => candidate.matches(q));
            const resultData = intent
                ? await intent.handle(ctx.db, ctx.orgId)
                : await askAiDefault(ctx.db, ctx.orgId);

            return {
                data: {
                    question: input.question,
                    result: resultData,
                },
                error: null,
                meta: null
            };
        })
});


